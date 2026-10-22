import {
  Categories,
  type CategorySlug,
  type PostCursorPosition,
  type PostSort,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import {
  SqlClient,
  type SqlError,
  SqlModel,
  SqlSchema,
  type Statement,
} from "effect/sql";
import { UserId } from "#domains/users/User";
import { dieOnSchemaError } from "#infrastructure/Sql";
import {
  type BlogId,
  BlogRow,
  BlogSlug,
  type PostId,
  PostRow,
  type PostSlug,
  PostSummaryRow,
} from "./Blog.ts";

/** A subblog with the numbers of its listing. */
export const BlogSummary = Schema.Struct({
  slug: BlogSlug,
  title: Schema.String,
  description: Schema.String,
  categories: Categories,
  createdAt: Schema.DateTimeUtcFromDate,
  postCount: Schema.Int,
  latestPostAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});
export type BlogSummary = typeof BlogSummary.Type;

/** A post in a list (without its text), with what the list shows besides. */
export interface PostListView {
  readonly post: PostSummaryRow;
  readonly blog: BlogSlug;
  /** The author's display name; none for a deleted or unknown author. */
  readonly authorName: Option.Option<string>;
  /** The author's id while their account exists; none once it is deleted. */
  readonly authorId: Option.Option<UserId>;
  readonly categories: Categories;
}

/** A whole post, text included. */
export interface PostView extends PostListView {
  readonly post: PostRow;
}

const PostExtras = Schema.Struct({
  blogSlug: BlogSlug,
  authorName: Schema.NullOr(Schema.String),
  publicAuthorId: Schema.NullOr(UserId),
  categories: Categories,
});

/** What a feed of published posts asks for. */
export interface FeedQuery {
  readonly blogId: Option.Option<BlogId>;
  readonly tag: Option.Option<string>;
  /** Only posts with this category, as main or extra. */
  readonly category: Option.Option<CategorySlug>;
  /** Only posts by this author, while their account exists. */
  readonly author: Option.Option<UserId>;
  readonly sort: PostSort;
  /** Where the previous page ended; its `sort` is the query's. */
  readonly after: Option.Option<PostCursorPosition>;
  readonly limit: number;
}

/** One column of a sort order and the cursor's value for it. */
interface SortKey {
  readonly expression: Statement.Fragment;
  readonly descending: boolean;
  /** The cursor's value as SQL, transformed like `expression`. */
  readonly value: Option.Option<Statement.Fragment>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const blogs = yield* SqlModel.makeRepository(BlogRow, {
    tableName: "blogs",
    spanPrefix: "BlogRepository.blogs",
    idColumn: "id",
  });
  const posts = yield* SqlModel.makeRepository(PostRow, {
    tableName: "blog_posts",
    spanPrefix: "BlogRepository.posts",
    idColumn: "id",
  });

  /**
   * The categories of the subblog or post `owner` as a JSON `Categories`:
   * `mc` is its main category, the extras (by name) come from `extras`.
   */
  const categoriesJson = (
    extras: "blog_extra_categories" | "blog_post_extra_categories",
    column: "blog_id" | "post_id",
    owner: Statement.Fragment,
  ) => sql`
    jsonb_build_object(
      'main', jsonb_build_object('slug', mc.slug, 'name', mc.name),
      'extra', COALESCE(
        (SELECT jsonb_agg(
                  jsonb_build_object('slug', c.slug, 'name', c.name)
                  ORDER BY lower(c.name), c.slug)
           FROM ${sql(extras)} x
           JOIN categories c ON c.id = x.category_id
          WHERE x.${sql(column)} = ${owner}),
        '[]'::jsonb)
    )
  `;

  // Published posts only count once they are published: drafts are no
  // business of readers.
  const summaries = (slug: Option.Option<BlogSlug>) => sql`
    SELECT b.slug, b.title, b.description, b.created_at,
           ${categoriesJson("blog_extra_categories", "blog_id", sql`b.id`)}
             AS categories,
           count(p.id)::int AS post_count,
           max(p.published_at) AS latest_post_at
    FROM blogs b
    JOIN categories mc ON mc.id = b.main_category_id
    LEFT JOIN blog_posts p ON p.blog_id = b.id AND p.status = 'published'
    ${Option.isSome(slug) ? sql`WHERE b.slug = ${slug.value}` : sql``}
    GROUP BY b.id, mc.id
    ORDER BY b.title, b.slug
  `;
  const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(BlogSummary));

  // The author's name and id are public only while their account exists;
  // a deleted account's tombstone has no name anyway.
  const authorName = sql`
    CASE WHEN u.deleted_at IS NULL THEN COALESCE(u.name, u.username) END
  `;

  // What every post query adds to the row: the subblog's slug, the
  // author's name and id, and the categories.
  const extras = sql`
    b.slug AS blog_slug,
    ${authorName} AS author_name,
    CASE WHEN u.deleted_at IS NULL THEN u.id END AS public_author_id,
    ${categoriesJson("blog_post_extra_categories", "post_id", sql`p.id`)}
      AS categories
  `;
  const from = sql`
    FROM blog_posts p
    JOIN blogs b ON b.id = p.blog_id
    JOIN categories mc ON mc.id = p.main_category_id
    LEFT JOIN users u ON u.id = p.author_id
  `;
  // Lists: every column but the content.
  const selectListViews = sql`
    SELECT p.id, p.blog_id, p.slug, p.title, p.summary, p.tags,
           p.main_category_id, p.cover_media_id, p.status, p.published_at,
           p.author_id, p.updated_by, p.created_at, p.updated_at, p.version,
           p.word_count, ${extras}
    ${from}
  `;
  const selectViews = sql`SELECT p.*, ${extras} ${from}`;

  const decodeExtras = Schema.decodeUnknownEffect(Schema.Array(PostExtras));
  const withExtras =
    <P>(
      decodeRows: (
        rows: ReadonlyArray<unknown>,
      ) => Effect.Effect<ReadonlyArray<P>, Schema.SchemaError>,
    ) =>
    (rows: ReadonlyArray<unknown>) =>
      Effect.zipWith(decodeRows(rows), decodeExtras(rows), (posts, extras) =>
        posts.map((post, index) => ({
          post,
          blog: extras[index]!.blogSlug,
          authorName: Option.fromNullOr(extras[index]!.authorName),
          authorId: Option.fromNullOr(extras[index]!.publicAuthorId),
          categories: extras[index]!.categories,
        })),
      );
  const toListViews = withExtras(
    Schema.decodeUnknownEffect(Schema.Array(PostSummaryRow)),
  );
  const toViews = withExtras(Schema.decodeUnknownEffect(Schema.Array(PostRow)));

  const findBlog = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: BlogRow,
    execute: (slug) => sql`SELECT * FROM blogs WHERE slug = ${slug}`,
  });

  /**
   * The columns of a sort order, the post id last, with the cursor's
   * values. Every expression is non-null, so keyset comparisons work.
   */
  const sortKeys = (
    sort: PostSort,
    after: Option.Option<PostCursorPosition>,
  ): ReadonlyArray<SortKey> => {
    const position = Option.getOrUndefined(after);
    const at = <K extends string>(key: K) =>
      position === undefined || !(key in position)
        ? Option.none()
        : Option.some((position as Record<K, unknown>)[key]);
    const time = (key: "publishedAt" | "updatedAt") =>
      Option.map(at(key), (value) => DateTime.toDateUtc(value as DateTime.Utc));
    // `lowered` keys compare with Postgres' lower(), like their ORDER BY:
    // JS toLowerCase follows other rules for some letters (and locales).
    const key = (
      expression: Statement.Fragment,
      descending: boolean,
      value: Option.Option<unknown>,
      lowered = false,
    ): SortKey => ({
      expression,
      descending,
      value: Option.map(value, (bound) =>
        lowered ? sql`lower(${bound}::text)` : sql`${bound}`,
      ),
    });
    const newestFirst = [key(sql`p.published_at`, true, time("publishedAt"))];
    const id = (descending: boolean) =>
      key(sql`p.id`, descending, Option.map(at("id"), String));
    switch (sort) {
      case "newest":
        return [...newestFirst, id(true)];
      case "oldest":
        return [
          key(sql`p.published_at`, false, time("publishedAt")),
          id(false),
        ];
      case "updated":
        // updated_at is written at millisecond precision, like the
        // cursor's; date_trunc makes sure the comparison is exact.
        return [
          key(
            sql`date_trunc('milliseconds', p.updated_at)`,
            true,
            time("updatedAt"),
          ),
          id(true),
        ];
      case "title":
        return [key(sql`lower(p.title)`, false, at("title"), true), id(false)];
      case "readingTime":
        return [key(sql`p.word_count`, false, at("words")), id(false)];
      case "category":
        return [
          key(sql`lower(mc.name)`, false, at("category"), true),
          ...newestFirst,
          id(true),
        ];
      case "author": {
        // Unknown and deleted authors last: false sorts before true.
        const name = at("author");
        return [
          key(
            sql`((${authorName}) IS NULL)`,
            false,
            Option.map(name, (value) => value === null),
          ),
          key(
            sql`lower(COALESCE(${authorName}, ''))`,
            false,
            Option.map(name, (value) => value ?? ""),
            true,
          ),
          ...newestFirst,
          id(true),
        ];
      }
    }
  };

  /**
   * The rows after the cursor in the order of `keys`: for some column, all
   * earlier ones equal and this one past the cursor's value.
   */
  const afterCursor = (keys: ReadonlyArray<SortKey>) => {
    const values = keys.flatMap((key) =>
      Option.isSome(key.value) ? [key.value.value] : [],
    );
    if (values.length !== keys.length) return sql``;
    const branches = keys.map((key, index) => {
      const equal = keys
        .slice(0, index)
        .map((earlier, at) => sql`${earlier.expression} = ${values[at]!}`);
      const past = key.descending
        ? sql`${key.expression} < ${values[index]!}`
        : sql`${key.expression} > ${values[index]!}`;
      return sql`(${sql.and([...equal, past])})`;
    });
    return sql`AND (${sql.or(branches)})`;
  };

  const orderBy = (keys: ReadonlyArray<SortKey>) =>
    sql.csv(
      keys.map(
        (key) =>
          sql`${key.expression} ${key.descending ? sql`DESC` : sql`ASC`}`,
      ),
    );

  return BlogRepository.of({
    listSummaries: summaries(Option.none()).pipe(
      Effect.flatMap(decodeSummaries),
      dieOnSchemaError,
      Effect.withSpan("BlogRepository.listSummaries"),
    ),

    findSummary: (slug) =>
      summaries(Option.some(slug)).pipe(
        Effect.flatMap(decodeSummaries),
        Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.findSummary"),
      ),

    findBlog: (slug) =>
      findBlog(slug).pipe(
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.findBlog"),
      ),

    insertBlog: (blog) =>
      blogs.insertVoid(BlogRow.insert.make(blog)).pipe(dieOnSchemaError),

    updateBlog: (blog) =>
      blogs.updateVoid(BlogRow.update.make(blog)).pipe(dieOnSchemaError),

    feed: ({ blogId, tag, category, author, sort, after, limit }) => {
      const keys = sortKeys(sort, after);
      return sql`
        ${selectListViews}
        WHERE p.status = 'published'
        ${Option.isSome(blogId) ? sql`AND p.blog_id = ${blogId.value}` : sql``}
        ${Option.isSome(tag) ? sql`AND p.tags @> ARRAY[${tag.value}]::text[]` : sql``}
        ${
          Option.isSome(category)
            ? sql`AND (mc.slug = ${category.value} OR EXISTS (
                SELECT 1 FROM blog_post_extra_categories x
                JOIN categories c ON c.id = x.category_id
                WHERE x.post_id = p.id AND c.slug = ${category.value}))`
            : sql``
        }
        ${
          Option.isSome(author)
            ? sql`AND p.author_id = ${author.value} AND u.deleted_at IS NULL`
            : sql``
        }
        ${afterCursor(keys)}
        ORDER BY ${orderBy(keys)}
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap(toListViews),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.feed"),
      );
    },

    findPublished: (blogId, slug) =>
      sql`
        ${selectViews}
        WHERE p.blog_id = ${blogId} AND p.slug = ${slug} AND p.status = 'published'
      `.pipe(
        Effect.flatMap(toViews),
        Effect.map((views) => Option.fromUndefinedOr(views[0])),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.findPublished"),
      ),

    listOfBlog: (blogId) =>
      sql`
        ${selectListViews}
        WHERE p.blog_id = ${blogId}
        ORDER BY p.updated_at DESC, p.id DESC
      `.pipe(
        Effect.flatMap(toListViews),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.listOfBlog"),
      ),

    findPost: (blogId, postId, options) =>
      sql`
        ${selectViews}
        WHERE p.blog_id = ${blogId} AND p.id = ${postId}
        ${options?.lock === true ? sql`FOR NO KEY UPDATE OF p` : sql``}
      `.pipe(
        Effect.flatMap(toViews),
        Effect.map((views) => Option.fromUndefinedOr(views[0])),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.findPost"),
      ),

    insertPost: (post) =>
      posts.insertVoid(PostRow.insert.make(post)).pipe(dieOnSchemaError),

    updatePost: (post) =>
      posts.updateVoid(PostRow.update.make(post)).pipe(dieOnSchemaError),

    deletePost: (postId) => posts.delete(postId).pipe(dieOnSchemaError),
  });
});

/**
 * Storage of subblogs (`blogs`) and their posts (`blog_posts`), read with
 * their categories. Used only inside the blogs domain; the categories
 * themselves are `CategoryRepository`'s.
 */
export class BlogRepository extends Context.Service<
  BlogRepository,
  {
    /** Every subblog, by title. */
    readonly listSummaries: Effect.Effect<
      ReadonlyArray<BlogSummary>,
      SqlError.SqlError
    >;
    readonly findSummary: (
      slug: BlogSlug,
    ) => Effect.Effect<Option.Option<BlogSummary>, SqlError.SqlError>;
    readonly findBlog: (
      slug: BlogSlug,
    ) => Effect.Effect<Option.Option<BlogRow>, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly insertBlog: (
      blog: BlogRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly updateBlog: (
      blog: BlogRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /**
     * Up to `limit` published posts in the order of `sort`, after `after`;
     * of one subblog or all, filtered by tag, category and author.
     */
    readonly feed: (
      query: FeedQuery,
    ) => Effect.Effect<ReadonlyArray<PostListView>, SqlError.SqlError>;
    readonly findPublished: (
      blogId: BlogId,
      slug: PostSlug,
    ) => Effect.Effect<Option.Option<PostView>, SqlError.SqlError>;
    /** All posts of a subblog, drafts included, last changed first. */
    readonly listOfBlog: (
      blogId: BlogId,
    ) => Effect.Effect<ReadonlyArray<PostListView>, SqlError.SqlError>;
    /** A post of the subblog; `lock` keeps it locked until the transaction ends. */
    readonly findPost: (
      blogId: BlogId,
      postId: PostId,
      options?: { readonly lock?: boolean },
    ) => Effect.Effect<Option.Option<PostView>, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly insertPost: (
      post: PostRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly updatePost: (
      post: PostRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly deletePost: (
      postId: PostId,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(BlogRepository, make);
}
