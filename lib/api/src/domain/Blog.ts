import { Document } from "#domain/Document";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { MediaId } from "#domain/Media";
import { noNul, slugString } from "#domain/Text";
import { type DateTime, Effect, Schema, SchemaGetter } from "effect";

/** Length limit of `BlogSlug`. */
export const BlogSlugMaxLength = 64;

/**
 * `BlogSlug` without its identifier, as a part of template literals such as
 * `BlogEditorRole`: JSON Schema generation (effect 4.0.5) cannot turn a part
 * with an identifier, i.e. a `$ref`, into a pattern and throws.
 */
export const BlogSlugPart = slugString(BlogSlugMaxLength, "rust-notes");

/**
 * The URL slug of a subblog, e.g. `rust-notes`: 1 to 64 lowercase ASCII
 * letters and digits, in groups separated by single hyphens.
 *
 * Deliberately not branded, so it can be a part of the template literal
 * `BlogEditorRole` (`blogEditor:<slug>`, built with `BlogSlugPart`).
 */
export const BlogSlug = BlogSlugPart.annotate({
  identifier: "BlogSlug",
  description: "URL slug of a subblog, e.g. `rust-notes`",
});
export type BlogSlug = typeof BlogSlug.Type;

// ---------------------------------------------------------------------------
// Subblogs and posts

/** Length and count limits of blogs and posts. */
export const BlogLimits = {
  blogTitleMaxLength: 120,
  blogDescriptionMaxLength: 1000,
  postSlugMaxLength: 128,
  postTitleMaxLength: 200,
  postSummaryMaxLength: 500,
  tagMaxLength: 32,
  /** Most tags on one post. */
  maxTags: 10,
} as const;

// Text fields are validated as already trimmed instead of trimmed during
// decoding, like `RestrictionNote` and the contact form's fields: clients
// trim before sending, and the OpenAPI document keeps the constraints. They
// reject NUL (`noNul`), which Postgres `text` cannot store.

/** The title of a subblog: trimmed, 1 to 120 characters. */
export const BlogTitle = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(BlogLimits.blogTitleMaxLength),
).annotate({
  identifier: "BlogTitle",
  description: "The title of a subblog: trimmed, 1 to 120 characters.",
});
export type BlogTitle = typeof BlogTitle.Type;

/** The description of a subblog: trimmed, at most 1000 characters. */
export const BlogDescription = Schema.Trimmed.check(
  noNul,
  Schema.isMaxLength(BlogLimits.blogDescriptionMaxLength),
).annotate({
  identifier: "BlogDescription",
  description:
    "The description of a subblog: trimmed, at most 1000 characters; may " +
    "be empty.",
});
export type BlogDescription = typeof BlogDescription.Type;

/** A subblog, as everyone sees it. */
export const Blog = Schema.Struct({
  slug: BlogSlug,
  title: BlogTitle,
  description: BlogDescription,
  createdAt: IsoDateTimeUtc,
  /** Number of published posts. */
  postCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** `publishedAt` of the newest published post; `null` without posts. */
  latestPostAt: Schema.NullOr(IsoDateTimeUtc),
}).annotate({
  identifier: "Blog",
  description:
    "A subblog with the number of its published posts and the time of the " +
    "newest one (null without posts).",
});
export type Blog = typeof Blog.Type;

/** Payload of `POST /admin/blogs`. */
export const CreateBlogPayload = Schema.Struct({
  /** Immutable once created: it is part of URLs and editor roles. */
  slug: BlogSlug,
  title: BlogTitle,
  description: BlogDescription,
}).annotate({ identifier: "CreateBlogPayload" });
export type CreateBlogPayload = typeof CreateBlogPayload.Type;

/** Payload of `PATCH /admin/blogs/:blog`: the new title and description. */
export const UpdateBlogPayload = Schema.Struct({
  title: BlogTitle,
  description: BlogDescription,
}).annotate({ identifier: "UpdateBlogPayload" });
export type UpdateBlogPayload = typeof UpdateBlogPayload.Type;

/**
 * The id of a post (a UUID). Editing addresses posts by id, because their
 * slug may change.
 */
export const PostId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("PostId"))
  .annotate({
    identifier: "PostId",
    description: "The id of a post (a UUID).",
  });
export type PostId = typeof PostId.Type;

/**
 * The URL slug of a post, unique within its subblog, e.g. `hello-world`:
 * 1 to 128 lowercase ASCII letters and digits, in groups separated by single
 * hyphens. Editors may change it.
 */
export const PostSlug = slugString(
  BlogLimits.postSlugMaxLength,
  "hello-world",
).annotate({
  identifier: "PostSlug",
  description:
    "URL slug of a post, unique within its subblog, e.g. `hello-world`; " +
    "1 to 128 characters.",
});
export type PostSlug = typeof PostSlug.Type;

/** The title of a post: trimmed, 1 to 200 characters. */
export const PostTitle = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(BlogLimits.postTitleMaxLength),
).annotate({
  identifier: "PostTitle",
  description: "The title of a post: trimmed, 1 to 200 characters.",
});
export type PostTitle = typeof PostTitle.Type;

/** The summary (teaser) of a post: trimmed plain text, at most 500 characters. */
export const PostSummary = Schema.Trimmed.check(
  noNul,
  Schema.isMaxLength(BlogLimits.postSummaryMaxLength),
).annotate({
  identifier: "PostSummary",
  description:
    "The summary (teaser) of a post: trimmed plain text, at most 500 " +
    "characters; may be empty.",
});
export type PostSummary = typeof PostSummary.Type;

/** A tag of a post or project, e.g. `rust`: a slug of 1 to 32 characters. */
export const Tag = slugString(BlogLimits.tagMaxLength, "type-systems").annotate(
  {
    identifier: "Tag",
    description:
      "A tag of a post or project, e.g. `type-systems`: 1 to 32 lowercase " +
      "ASCII letters and digits in groups separated by single hyphens.",
  },
);
export type Tag = typeof Tag.Type;

/** The tags of a post: at most 10, without duplicates. */
export const PostTags = Schema.UniqueArray(Tag)
  .check(Schema.isMaxLength(BlogLimits.maxTags))
  .annotate({
    description: "The tags of a post: at most 10, without duplicates.",
  });

/** Whether a post is visible to everyone (`published`) or only to editors. */
export const PostStatus = Schema.Literals(["draft", "published"]).annotate({
  identifier: "PostStatus",
  description:
    "`published` posts are visible to everyone, `draft` posts only to the " +
    "subblog's editors.",
});
export type PostStatus = typeof PostStatus.Type;

/**
 * The version of a post, for optimistic locking: 1 when created, one more
 * with every saved change.
 */
export const PostVersion = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
).annotate({
  identifier: "PostVersion",
  description:
    "The version of a post: 1 when created, one more with every saved " +
    "change.",
});
export type PostVersion = typeof PostVersion.Type;

/** Who wrote a post. */
export const PostAuthor = Schema.Struct({
  /**
   * The display name (the full name, else the username); `null` if the
   * account has been deleted or has neither.
   */
  name: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "PostAuthor",
  description: "The author of a post; `name` is null for deleted accounts.",
});
export type PostAuthor = typeof PostAuthor.Type;

/** A published post in a list: everything but its content. */
export const PostListItem = Schema.Struct({
  id: PostId,
  blog: BlogSlug,
  slug: PostSlug,
  title: PostTitle,
  summary: PostSummary,
  tags: PostTags,
  /** The cover image; `null` without one. Shown via `mediaUrl`. */
  coverImage: Schema.NullOr(MediaId),
  /** When the post was first published. */
  publishedAt: IsoDateTimeUtc,
  updatedAt: IsoDateTimeUtc,
  author: PostAuthor,
  /** Estimated reading time in whole minutes. */
  readingMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({
  identifier: "PostListItem",
  description: "A published post without its content, for lists.",
});
export type PostListItem = typeof PostListItem.Type;

/** A published post with its content. Body of `getPost`. */
export const PublishedPost = Schema.Struct({
  ...PostListItem.fields,
  content: Document,
}).annotate({
  identifier: "PublishedPost",
  description: "A published post with its content.",
});
export type PublishedPost = typeof PublishedPost.Type;

const managedPostFields = {
  id: PostId,
  blog: BlogSlug,
  slug: PostSlug,
  title: PostTitle,
  summary: PostSummary,
  tags: PostTags,
  coverImage: Schema.NullOr(MediaId),
  status: PostStatus,
  /**
   * When the post was first published; `null` if it never was. Kept when
   * it is unpublished and republished: `status` decides the visibility.
   */
  publishedAt: Schema.NullOr(IsoDateTimeUtc),
  createdAt: IsoDateTimeUtc,
  updatedAt: IsoDateTimeUtc,
  /** The version to send back with `updatePost`. */
  version: PostVersion,
  author: PostAuthor,
};

/** A post of any status as its editors see it, without content. */
export const ManagedPostListItem = Schema.Struct(managedPostFields).annotate({
  identifier: "ManagedPostListItem",
  description:
    "A post of any status as the subblog's editors see it, without content.",
});
export type ManagedPostListItem = typeof ManagedPostListItem.Type;

/** A post of any status as its editors see it, with its content. */
export const ManagedPost = Schema.Struct({
  ...managedPostFields,
  content: Document,
}).annotate({
  identifier: "ManagedPost",
  description:
    "A post of any status as the subblog's editors see it, with content " +
    "and `version`.",
});
export type ManagedPost = typeof ManagedPost.Type;

const postInputFields = {
  slug: PostSlug,
  title: PostTitle,
  summary: PostSummary,
  tags: PostTags,
  coverImage: Schema.NullOr(MediaId),
  content: Document,
};

/** Payload of `createPost`: the new post's fields; it starts as a draft. */
export const PostInput = Schema.Struct(postInputFields).annotate({
  identifier: "PostInput",
  description: "The editable fields of a post.",
});
export type PostInput = typeof PostInput.Type;

/** Payload of `updatePost`: the new fields and the version they are based on. */
export const UpdatePostPayload = Schema.Struct({
  ...postInputFields,
  /**
   * The `version` of the post the editor started from. If the post has
   * been saved since, the update fails with `PostEditConflict`.
   */
  version: PostVersion,
}).annotate({
  identifier: "UpdatePostPayload",
  description:
    "The editable fields of a post and the `version` the edit is based on " +
    "(optimistic locking).",
});
export type UpdatePostPayload = typeof UpdatePostPayload.Type;

/** Paging limits of the post lists. */
export const PostPageLimits = {
  /** Page size when `limit` is absent. */
  defaultLimit: 10,
  /** Largest page size accepted. */
  maxLimit: 50,
} as const;

/**
 * Longest accepted encoded `PostCursor`. A real cursor is about 70
 * characters (`[<epoch millis>,"<uuid>"]` in base64url), like `UserCursor`.
 */
export const PostCursorMaxLength = 128;

/** Decoded form of `PostCursor`: the position of one post in the order. */
export interface PostCursorPosition {
  /** `publishedAt` of the post, at millisecond precision. */
  readonly publishedAt: DateTime.Utc;
  readonly id: PostId;
}

/**
 * Position in a list of published posts: the `publishedAt` and `id` of the
 * last post of a page. Clients treat it as an opaque string and pass
 * `nextCursor` back as `cursor`.
 *
 * Encoded: base64url (no padding) of the JSON array
 * `[publishedAtEpochMillis, postId]`. Decoded: `{ publishedAt, id }`.
 * Anything else fails decoding (400), like `UserCursor`.
 */
export const PostCursor = Schema.String.annotate({
  description:
    "Opaque position in a post list: pass the `nextCursor` of a page as " +
    "`cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(PostCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(Schema.Tuple([Schema.DateTimeUtcFromMillis, PostId])),
  ),
  Schema.decodeTo(
    Schema.Struct({
      publishedAt: Schema.DateTimeUtc,
      // Only the Type of `PostId`: the tuple above has validated it.
      id: Schema.toType(PostId),
    }),
    {
      decode: SchemaGetter.transform(([publishedAt, id]) => ({
        publishedAt,
        id,
      })),
      encode: SchemaGetter.transform(
        ({ publishedAt, id }) => [publishedAt, id] as const,
      ),
    },
  ),
  Schema.annotate({ identifier: "PostCursor" }),
);
export type PostCursor = typeof PostCursor.Type;

/**
 * Query of the published post lists (`listPosts`, `recentPosts`). Posts are
 * ordered by `publishedAt`, then `id`, descending (newest first). Decoding
 * fills in the default `limit`; in the generated client `limit` is
 * therefore required (pass `PostPageLimits.defaultLimit`).
 */
export const PostPageQuery = Schema.Struct({
  /** Page size, 1 to 50; 10 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: PostPageLimits.maxLimit }),
  )
    // Described on the key, before the default (see `UserPageQuery`).
    .annotateKey({
      description: "Page size, an integer from 1 to 50; 10 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(
        Effect.succeed(PostPageLimits.defaultLimit),
      ),
    ),
  /** The `nextCursor` of the previous page; absent for the first page. */
  cursor: Schema.optionalKey(PostCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
  /** Only posts with this tag. */
  tag: Schema.optionalKey(Tag).annotateKey({
    description: "Only posts with this tag.",
  }),
}).annotate({ identifier: "PostPageQuery" });
export type PostPageQuery = typeof PostPageQuery.Type;

/** One page of published posts. */
export const PostPage = Schema.Struct({
  posts: Schema.Array(PostListItem),
  /**
   * The position after the last returned post, to pass as `cursor` for the
   * next page; `null` on the last page.
   */
  nextCursor: Schema.NullOr(PostCursor),
}).annotate({
  identifier: "PostPage",
  description:
    "One page of published posts, newest first (by `publishedAt`, then " +
    "`id`). `nextCursor` is the position after the last returned post, or " +
    "null on the last page.",
});
export type PostPage = typeof PostPage.Type;
