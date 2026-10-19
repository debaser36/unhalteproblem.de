import {
  BlogDescription,
  BlogSlug,
  BlogTitle,
  Document,
  documentText,
  MediaId,
  PostId,
  PostSlug,
  PostStatus,
  PostSummary,
  PostTitle,
  Tag,
} from "@unhalteproblem.de/api";
import { DateTime, Option, Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "#domains/users/User";

/**
 * Subblogs and their posts. A subblog (`blogs`) is created and renamed by
 * admins; its posts (`blog_posts`) are written in place on the website by
 * the holders of `blogEditor:<slug>`. A post is a draft until it is
 * published; only published posts are public. Edits are guarded by a
 * version number, so two editors can't overwrite each other unnoticed.
 */

export { BlogSlug, PostId, PostSlug, PostStatus };

/** Our id of a subblog; the API addresses subblogs by their slug instead. */
export const BlogId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("BlogId"),
);
export type BlogId = typeof BlogId.Type;

/** A subblog as stored. The slug never changes: it is in URLs and in roles. */
export class BlogRow extends Model.Class<BlogRow>("BlogRow")({
  id: BlogId,
  slug: BlogSlug.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  title: BlogTitle,
  description: BlogDescription,
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  createdBy: Schema.OptionFromNullOr(UserId).pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  updatedAt: Schema.DateTimeUtcFromDate,
}) {}

// jsonb comes back parsed; it's written as JSON text, which Postgres
// converts to jsonb (as in `Session.claims`).
const DocumentColumn = Model.Field({
  select: Document,
  insert: Schema.fromJsonString(Document),
  update: Schema.fromJsonString(Document),
  json: Document,
});

/** A post as stored. */
export class PostRow extends Model.Class<PostRow>("PostRow")({
  id: PostId,
  blogId: BlogId.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  slug: PostSlug,
  title: PostTitle,
  summary: PostSummary,
  tags: Schema.Array(Tag),
  coverMediaId: Schema.OptionFromNullOr(MediaId),
  content: DocumentColumn,
  status: PostStatus,
  /** When the post was first published; kept when it goes back to draft. */
  publishedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
  authorId: Schema.OptionFromNullOr(UserId).pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  updatedBy: Schema.OptionFromNullOr(UserId),
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  updatedAt: Schema.DateTimeUtcFromDate,
  version: Schema.Int,
}) {}

// Errors: the contract's, so they map to their status codes as they are.
export {
  BlogNotFound,
  BlogSlugTaken,
  PostEditConflict,
  PostNotFound,
  PostSlugTaken,
} from "@unhalteproblem.de/api";

// Events

export class BlogCreated extends Schema.TaggedClass<
  BlogCreated,
  { readonly brand: unique symbol }
>()("BlogCreated", { blog: BlogSlug, by: UserId }) {}

export class PostSaved extends Schema.TaggedClass<
  PostSaved,
  { readonly brand: unique symbol }
>()("PostSaved", {
  blog: BlogSlug,
  postId: PostId,
  version: Schema.Int,
  by: UserId,
}) {}

export class PostPublished extends Schema.TaggedClass<
  PostPublished,
  { readonly brand: unique symbol }
>()("PostPublished", { blog: BlogSlug, postId: PostId, by: UserId }) {}

export class PostUnpublished extends Schema.TaggedClass<
  PostUnpublished,
  { readonly brand: unique symbol }
>()("PostUnpublished", { blog: BlogSlug, postId: PostId, by: UserId }) {}

export class PostDeleted extends Schema.TaggedClass<
  PostDeleted,
  { readonly brand: unique symbol }
>()("PostDeleted", { blog: BlogSlug, postId: PostId, by: UserId }) {}

export type BlogEvent =
  BlogCreated | PostSaved | PostPublished | PostUnpublished | PostDeleted;

// Rules

/** Reading speed for `readingMinutes`, in words per minute. */
const WORDS_PER_MINUTE = 220;

/** Minutes a post takes to read: its words at 220 per minute, at least 1 if it has any. */
export const readingMinutes = (content: Document): number => {
  const words = documentText(content).split(/\s+/u).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

/**
 * The post, published at `now`: a post published before keeps its first
 * publication time, so republishing doesn't move it to the top of the feed.
 */
export const publish = (post: PostRow, now: DateTime.Utc): PostRow =>
  PostRow.make({
    ...post,
    status: "published",
    publishedAt: Option.some(Option.getOrElse(post.publishedAt, () => now)),
  });

/**
 * Whether an editor who started from `version` may save over `current`:
 * only if nobody saved in between.
 */
export const isStale = (current: PostRow, version: number): boolean =>
  current.version !== version;

/** Postgres' unique constraint on a subblog's post slugs. */
export const postSlugConstraint = "blog_posts_blog_id_slug_key";

/** Postgres' unique constraint on subblog slugs. */
export const blogSlugConstraint = "blogs_slug_key";
