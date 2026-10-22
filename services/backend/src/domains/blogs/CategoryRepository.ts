import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlModel, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";
import type { UserId } from "#domains/users/User";
import type { BlogId, PostId } from "./Blog.ts";
import {
  type CategoryId,
  CategoryRow,
  CategorySlug,
  type NamedCategory,
} from "./Category.ts";

/** A category with the number of subblogs and published posts using it. */
export const CategorySummary = Schema.Struct({
  slug: CategorySlug,
  name: Schema.String,
  blogCount: Schema.Int,
  postCount: Schema.Int,
});
export type CategorySummary = typeof CategorySummary.Type;

/** How many subblogs and posts (drafts included) use a category. */
export interface CategoryUsage {
  readonly blogCount: number;
  readonly postCount: number;
}

const Usage = Schema.Struct({ blogCount: Schema.Int, postCount: Schema.Int });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const categories = yield* SqlModel.makeRepository(CategoryRow, {
    tableName: "categories",
    spanPrefix: "CategoryRepository",
    idColumn: "id",
  });

  // A subblog or post never has a category both as main and as extra, so
  // the two counts add up without counting anything twice.
  const summaries = (slug: Option.Option<CategorySlug>) => sql`
    SELECT c.slug, c.name,
      (SELECT count(*)::int FROM blogs WHERE main_category_id = c.id)
        + (SELECT count(*)::int FROM blog_extra_categories
            WHERE category_id = c.id)
        AS blog_count,
      (SELECT count(*)::int FROM blog_posts
        WHERE main_category_id = c.id AND status = 'published')
        + (SELECT count(*)::int
             FROM blog_post_extra_categories x
             JOIN blog_posts p ON p.id = x.post_id
            WHERE x.category_id = c.id AND p.status = 'published')
        AS post_count
    FROM categories c
    ${Option.isSome(slug) ? sql`WHERE c.slug = ${slug.value}` : sql``}
    ORDER BY lower(c.name), c.slug
  `;
  const decodeSummaries = Schema.decodeUnknownEffect(
    Schema.Array(CategorySummary),
  );

  const findBySlug = SqlSchema.findOneOption({
    Request: Schema.Struct({ slug: Schema.String, lock: Schema.Boolean }),
    Result: CategoryRow,
    execute: ({ slug, lock }) => sql`
      SELECT * FROM categories WHERE slug = ${slug}
      ${lock ? sql`FOR UPDATE` : sql``}
    `,
  });

  const replaceExtras = (
    table: "blog_extra_categories" | "blog_post_extra_categories",
    column: "blog_id" | "post_id",
    owner: string,
    extra: ReadonlyArray<CategoryId>,
  ) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM ${sql(table)} WHERE ${sql(column)} = ${owner}`;
      if (extra.length > 0) {
        yield* sql`
          INSERT INTO ${sql(table)} ${sql.insert(
            extra.map((category) => ({
              [column]: owner,
              categoryId: category,
            })),
          )}
        `;
      }
    });

  // Moves every use of `source` to `target` in one owner table pair:
  // mains are re-pointed, extras replaced (dropped where the owner already
  // has `target`, as main or extra), then the source's extras removed.
  const moveUses = (
    owners: "blogs" | "blog_posts",
    extras: "blog_extra_categories" | "blog_post_extra_categories",
    column: "blog_id" | "post_id",
    source: CategoryId,
    target: CategoryId,
  ) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE ${sql(owners)} SET main_category_id = ${target}
        WHERE main_category_id = ${source}
      `;
      yield* sql`
        INSERT INTO ${sql(extras)} (${sql(column)}, category_id)
        SELECT x.${sql(column)}, ${target}::uuid
        FROM ${sql(extras)} x
        JOIN ${sql(owners)} o ON o.id = x.${sql(column)}
        WHERE x.category_id = ${source} AND o.main_category_id <> ${target}
        ON CONFLICT DO NOTHING
      `;
      // Owners whose main was the source and that had the target as extra.
      yield* sql`
        DELETE FROM ${sql(extras)} x
        USING ${sql(owners)} o
        WHERE o.id = x.${sql(column)}
          AND x.category_id = ${target}
          AND o.main_category_id = ${target}
      `;
      yield* sql`DELETE FROM ${sql(extras)} WHERE category_id = ${source}`;
    });

  return CategoryRepository.of({
    list: summaries(Option.none()).pipe(
      Effect.flatMap(decodeSummaries),
      dieOnSchemaError,
      Effect.withSpan("CategoryRepository.list"),
    ),

    findSummary: (slug) =>
      summaries(Option.some(slug)).pipe(
        Effect.flatMap(decodeSummaries),
        Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
        dieOnSchemaError,
        Effect.withSpan("CategoryRepository.findSummary"),
      ),

    findBySlug: (slug, options) =>
      findBySlug({ slug, lock: options?.lock === true }).pipe(
        dieOnSchemaError,
        Effect.withSpan("CategoryRepository.findBySlug"),
      ),

    ensure: Effect.fnUntraced(function* (named, createdBy, now) {
      if (named.length === 0) return { ids: [], created: [] };
      // In slug order, so two editors creating the same new categories
      // wait for each other instead of deadlocking.
      const sorted = [...named].sort((a, b) =>
        a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
      );
      const created = new Set<CategorySlug>();
      // An admin may merge or delete a category between the INSERT (which
      // doesn't lock an existing row) and the locking SELECT; the second
      // attempt then creates it anew.
      for (let attempt = 1; ; attempt++) {
        // ON CONFLICT DO NOTHING: an existing slug (or one another editor
        // creates concurrently) is used as it is, under its existing name.
        const inserted = yield* sql<{ readonly slug: string }>`
          INSERT INTO categories ${sql.insert(
            sorted.map(({ slug, name }) => ({
              id: crypto.randomUUID(),
              slug,
              name,
              createdAt: DateTime.toDateUtc(now),
              createdBy: Option.getOrNull(createdBy),
            })),
          )}
          ON CONFLICT (slug) DO NOTHING
          RETURNING slug
        `;
        for (const { slug } of inserted) created.add(slug as CategorySlug);
        // FOR KEY SHARE keeps the categories from being merged away or
        // deleted until the transaction that uses them ends; in slug
        // order, like the admins' merges, so the two never deadlock.
        const rows = yield* sql<{
          readonly id: CategoryId;
          readonly slug: string;
        }>`
          SELECT id, slug FROM categories
          WHERE slug IN ${sql.in(sorted.map(({ slug }) => slug))}
          ORDER BY slug COLLATE "C"
          FOR KEY SHARE
        `;
        const idOf = new Map(rows.map((row) => [row.slug, row.id]));
        const ids = named.flatMap(({ slug }) => {
          const id = idOf.get(slug);
          return id === undefined ? [] : [id];
        });
        if (ids.length === named.length) return { ids, created: [...created] };
        if (attempt === 2) {
          return yield* Effect.die(
            new Error("Category vanished inside its transaction"),
          );
        }
      }
    }, Effect.withSpan("CategoryRepository.ensure")),

    setBlogMain: (blogId, main, now) =>
      sql`
        UPDATE blogs
        SET main_category_id = ${main}, updated_at = ${DateTime.toDateUtc(now)}
        WHERE id = ${blogId}
      `.pipe(Effect.asVoid, Effect.withSpan("CategoryRepository.setBlogMain")),

    setBlogExtras: (blogId, extra) =>
      replaceExtras("blog_extra_categories", "blog_id", blogId, extra).pipe(
        Effect.withSpan("CategoryRepository.setBlogExtras"),
      ),

    setPostExtras: (postId, extra) =>
      replaceExtras(
        "blog_post_extra_categories",
        "post_id",
        postId,
        extra,
      ).pipe(Effect.withSpan("CategoryRepository.setPostExtras")),

    usage: (id) =>
      sql`
        SELECT
          (SELECT count(*)::int FROM blogs WHERE main_category_id = ${id})
            + (SELECT count(*)::int FROM blog_extra_categories
                WHERE category_id = ${id}) AS blog_count,
          (SELECT count(*)::int FROM blog_posts
            WHERE main_category_id = ${id})
            + (SELECT count(*)::int FROM blog_post_extra_categories
                WHERE category_id = ${id}) AS post_count
      `.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Usage))),
        Effect.map((rows) => rows[0] ?? { blogCount: 0, postCount: 0 }),
        dieOnSchemaError,
        Effect.withSpan("CategoryRepository.usage"),
      ),

    update: (row) =>
      categories
        .updateVoid(CategoryRow.update.make(row))
        .pipe(dieOnSchemaError),

    merge: (source, target) =>
      Effect.gen(function* () {
        yield* moveUses(
          "blogs",
          "blog_extra_categories",
          "blog_id",
          source,
          target,
        );
        yield* moveUses(
          "blog_posts",
          "blog_post_extra_categories",
          "post_id",
          source,
          target,
        );
        yield* categories.delete(source).pipe(dieOnSchemaError);
      }).pipe(Effect.withSpan("CategoryRepository.merge")),

    delete: (id) => categories.delete(id).pipe(dieOnSchemaError),
  });
});

/**
 * Storage of categories (`categories`) and of which subblogs and posts use
 * them (`main_category_id`, `blog_extra_categories`,
 * `blog_post_extra_categories`). Used only inside the blogs domain; the
 * subblogs' and posts' categories are read with them by `BlogRepository`.
 */
export class CategoryRepository extends Context.Service<
  CategoryRepository,
  {
    /** Every category by name, with its public counts. */
    readonly list: Effect.Effect<
      ReadonlyArray<CategorySummary>,
      SqlError.SqlError
    >;
    readonly findSummary: (
      slug: CategorySlug,
    ) => Effect.Effect<Option.Option<CategorySummary>, SqlError.SqlError>;
    /** `lock` keeps it locked against any use until the transaction ends. */
    readonly findBySlug: (
      slug: CategorySlug,
      options?: { readonly lock?: boolean },
    ) => Effect.Effect<Option.Option<CategoryRow>, SqlError.SqlError>;
    /**
     * The ids of the named categories, in order, creating those that don't
     * exist yet; also the slugs of the created ones. Keeps them locked
     * against merging and deleting until the transaction ends.
     */
    readonly ensure: (
      named: ReadonlyArray<NamedCategory>,
      createdBy: Option.Option<UserId>,
      now: DateTime.Utc,
    ) => Effect.Effect<
      {
        readonly ids: ReadonlyArray<CategoryId>;
        readonly created: ReadonlyArray<CategorySlug>;
      },
      SqlError.SqlError
    >;
    /** Sets the main category of a subblog (and its `updated_at`). */
    readonly setBlogMain: (
      blogId: BlogId,
      main: CategoryId,
      now: DateTime.Utc,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Replaces the extra categories of a subblog; its main one is a column of `blogs`. */
    readonly setBlogExtras: (
      blogId: BlogId,
      extra: ReadonlyArray<CategoryId>,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Replaces the extra categories of a post; its main one is a column of `blog_posts`. */
    readonly setPostExtras: (
      postId: PostId,
      extra: ReadonlyArray<CategoryId>,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Uses by subblogs and by posts of any status. */
    readonly usage: (
      id: CategoryId,
    ) => Effect.Effect<CategoryUsage, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly update: (
      row: CategoryRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Moves every use of `source` to `target` and deletes `source`. */
    readonly merge: (
      source: CategoryId,
      target: CategoryId,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Fails with a `ForeignKeyViolation` while it is used. */
    readonly delete: (id: CategoryId) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/CategoryRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(CategoryRepository, make);
}
