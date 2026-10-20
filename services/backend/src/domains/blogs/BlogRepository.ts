import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlModel, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#repositories/Sql";
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
  /** Words of the text, for the reading time. */
  readonly words: number;
}

/** A whole post, text included. */
export interface PostView extends PostListView {
  readonly post: PostRow;
}

const PostExtras = Schema.Struct({
  blogSlug: BlogSlug,
  authorName: Schema.NullOr(Schema.String),
  wordCount: Schema.Int,
});

/** Position in a feed of published posts: newest first, then by id. */
export interface FeedPosition {
  readonly publishedAt: DateTime.Utc;
  readonly id: PostId;
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

  // Published posts only count once they are published: drafts are no
  // business of readers.
  const summaries = (slug: Option.Option<BlogSlug>) => sql`
    SELECT b.slug, b.title, b.description, b.created_at,
           count(p.id)::int AS post_count,
           max(p.published_at) AS latest_post_at
    FROM blogs b
    LEFT JOIN blog_posts p ON p.blog_id = b.id AND p.status = 'published'
    ${Option.isSome(slug) ? sql`WHERE b.slug = ${slug.value}` : sql``}
    GROUP BY b.id
    ORDER BY b.title, b.slug
  `;
  const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(BlogSummary));

  // What every post query adds to the row: the subblog's slug, the
  // author's name (only while their account exists; a deleted account's
  // tombstone has none anyway), and the number of words of the text,
  // counted here so that lists never load the documents.
  const extras = sql`
    b.slug AS blog_slug,
    CASE WHEN u.deleted_at IS NULL THEN COALESCE(u.name, u.username) END
      AS author_name,
    (SELECT count(*)::int
       FROM jsonb_path_query(p.content, 'strict $.**.text') AS t(text),
            regexp_split_to_table(t.text #>> '{}', '\\s+') AS w(word)
      WHERE w.word <> '') AS word_count
  `;
  const from = sql`
    FROM blog_posts p
    JOIN blogs b ON b.id = p.blog_id
    LEFT JOIN users u ON u.id = p.author_id
  `;
  // Lists: every column but the content.
  const selectListViews = sql`
    SELECT p.id, p.blog_id, p.slug, p.title, p.summary, p.tags,
           p.cover_media_id, p.status, p.published_at, p.author_id,
           p.updated_by, p.created_at, p.updated_at, p.version, ${extras}
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
          words: extras[index]!.wordCount,
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

    feed: ({ blogId, tag, after, limit }) =>
      sql`
        ${selectListViews}
        WHERE p.status = 'published'
        ${Option.isSome(blogId) ? sql`AND p.blog_id = ${blogId.value}` : sql``}
        ${Option.isSome(tag) ? sql`AND p.tags @> ARRAY[${tag.value}]::text[]` : sql``}
        ${
          Option.isSome(after)
            ? sql`AND (p.published_at, p.id) < (${DateTime.toDateUtc(after.value.publishedAt)}, ${after.value.id}::uuid)`
            : sql``
        }
        ORDER BY p.published_at DESC, p.id DESC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap(toListViews),
        dieOnSchemaError,
        Effect.withSpan("BlogRepository.feed"),
      ),

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
 * Storage of subblogs (`blogs`) and their posts (`blog_posts`). Used only
 * inside the blogs domain.
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
     * Up to `limit` published posts, newest first, after `after`; of one
     * subblog or all, with `tag` or any.
     */
    readonly feed: (query: {
      readonly blogId: Option.Option<BlogId>;
      readonly tag: Option.Option<string>;
      readonly after: Option.Option<FeedPosition>;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<PostListView>, SqlError.SqlError>;
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
