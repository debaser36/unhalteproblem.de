import { Categories, CategoriesInput, CategorySlug } from "#domain/Category";
import { Document } from "#domain/Document";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { MediaId } from "#domain/Media";
import { noNul, slugString } from "#domain/Text";
import { UserId } from "#domain/UserId";
import { Effect, Schema, SchemaGetter } from "effect";

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
  /** The main category and up to three extra ones. */
  categories: Categories,
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
  /** Names of the categories; unknown names create new categories. */
  categories: CategoriesInput,
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
   * The author's user id, to filter posts by author; `null` if the
   * account has been deleted.
   */
  id: Schema.NullOr(UserId),
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
  categories: Categories,
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
  categories: Categories,
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
  /** Names of the categories; unknown names create new categories. */
  categories: CategoriesInput,
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
 * The order of a post list. Every order ends with `id` as the tie breaker,
 * so pages never overlap or skip posts.
 *
 * - `newest`: `publishedAt` descending (the default);
 * - `oldest`: `publishedAt` ascending;
 * - `updated`: `updatedAt` descending (last updated first);
 * - `title`: title A to Z;
 * - `readingTime`: shortest first (by the number of words);
 * - `category`: name of the main category A to Z, then newest;
 * - `author`: display name of the author A to Z, deleted or unknown
 *   authors last, then newest.
 */
export const PostSort = Schema.Literals([
  "newest",
  "oldest",
  "updated",
  "title",
  "readingTime",
  "category",
  "author",
]).annotate({
  identifier: "PostSort",
  description:
    "The order of a post list: `newest` (default) and `oldest` by " +
    "publication time, `updated` (last updated first), `title` (A to Z), " +
    "`readingTime` (shortest first), `category` (main category name A to " +
    "Z, then newest) and `author` (author name A to Z, deleted or unknown " +
    "authors last, then newest). Ties are broken by post id.",
});
export type PostSort = typeof PostSort.Type;

/**
 * Longest accepted encoded `PostCursor`. The cursor holds the sort keys of
 * one post as JSON: a title of at most 200 UTF-16 units (3 UTF-8 bytes per
 * unit at most, 6 JSON bytes for escaped control characters, so 1200 bytes
 * in the very worst case), a main category name of at most 48 units, an
 * author name and a UUID. The base64url form is 4/3 as long, so the worst
 * title alone needs about 1600 characters; 4096 leaves room for author
 * names of several hundred characters. Real cursors have 70 to 250
 * characters.
 */
export const PostCursorMaxLength = 4096;

const cursorTime = Schema.DateTimeUtc;
// Only the Type of `PostId`: the wire tuples below have validated it.
const cursorId = Schema.toType(PostId);
const cursorWords = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * Decoded form of `PostCursor`: the sort and the sort keys of the last post
 * of a page, tagged by `sort`. Times have millisecond precision.
 */
export const PostCursorPosition = Schema.Union([
  Schema.Struct({
    sort: Schema.Literals(["newest", "oldest"]),
    publishedAt: cursorTime,
    id: cursorId,
  }),
  Schema.Struct({
    sort: Schema.Literal("updated"),
    updatedAt: cursorTime,
    id: cursorId,
  }),
  Schema.Struct({
    sort: Schema.Literal("title"),
    title: Schema.String,
    id: cursorId,
  }),
  Schema.Struct({
    sort: Schema.Literal("readingTime"),
    /** Word count of the post, the sort key behind `readingMinutes`. */
    words: cursorWords,
    id: cursorId,
  }),
  Schema.Struct({
    sort: Schema.Literal("category"),
    /** Name of the main category. */
    category: Schema.String,
    publishedAt: cursorTime,
    id: cursorId,
  }),
  Schema.Struct({
    sort: Schema.Literal("author"),
    /** Display name of the author; `null` for deleted or unknown authors. */
    author: Schema.NullOr(Schema.String),
    publishedAt: cursorTime,
    id: cursorId,
  }),
]);
export type PostCursorPosition = typeof PostCursorPosition.Type;

// The JSON wire form: a tuple tagged by the first element.
const PostCursorWire = Schema.Union([
  Schema.Tuple([
    Schema.Literals(["n", "o"]),
    Schema.DateTimeUtcFromMillis,
    PostId,
  ]),
  Schema.Tuple([Schema.Literal("u"), Schema.DateTimeUtcFromMillis, PostId]),
  Schema.Tuple([Schema.Literal("t"), Schema.String, PostId]),
  Schema.Tuple([Schema.Literal("r"), cursorWords, PostId]),
  Schema.Tuple([
    Schema.Literal("c"),
    Schema.String,
    Schema.DateTimeUtcFromMillis,
    PostId,
  ]),
  Schema.Tuple([
    Schema.Literal("a"),
    Schema.NullOr(Schema.String),
    Schema.DateTimeUtcFromMillis,
    PostId,
  ]),
]);

/**
 * Position in a list of published posts: the sort and the sort keys of the
 * last post of a page. Clients treat it as an opaque string and pass
 * `nextCursor` back as `cursor`, with the same `sort`.
 *
 * Encoded: base64url (no padding) of a JSON array tagged by its first
 * element, `[<tag>, ...sort keys, postId]`, times as epoch milliseconds:
 *
 * - `["n", publishedAt, id]` (`newest`), `["o", publishedAt, id]` (`oldest`)
 * - `["u", updatedAt, id]` (`updated`)
 * - `["t", title, id]` (`title`)
 * - `["r", words, id]` (`readingTime`)
 * - `["c", mainCategoryName, publishedAt, id]` (`category`)
 * - `["a", authorName | null, publishedAt, id]` (`author`)
 *
 * Decoded: `PostCursorPosition`, `{ sort, ...keys, id }`. Anything else
 * fails decoding (400), like `UserCursor`.
 */
export const PostCursor = Schema.String.annotate({
  description:
    "Opaque position in a post list: pass the `nextCursor` of a page as " +
    "`cursor` to get the next one, with the same `sort`.",
}).pipe(
  Schema.check(Schema.isMaxLength(PostCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(Schema.fromJsonString(PostCursorWire)),
  Schema.decodeTo(PostCursorPosition, {
    decode: SchemaGetter.transform((wire): PostCursorPosition => {
      switch (wire[0]) {
        case "n":
          return { sort: "newest", publishedAt: wire[1], id: wire[2] };
        case "o":
          return { sort: "oldest", publishedAt: wire[1], id: wire[2] };
        case "u":
          return { sort: "updated", updatedAt: wire[1], id: wire[2] };
        case "t":
          return { sort: "title", title: wire[1], id: wire[2] };
        case "r":
          return { sort: "readingTime", words: wire[1], id: wire[2] };
        case "c":
          return {
            sort: "category",
            category: wire[1],
            publishedAt: wire[2],
            id: wire[3],
          };
        case "a":
          return {
            sort: "author",
            author: wire[1],
            publishedAt: wire[2],
            id: wire[3],
          };
      }
    }),
    encode: SchemaGetter.transform((position): typeof PostCursorWire.Type => {
      switch (position.sort) {
        case "newest":
          return ["n", position.publishedAt, position.id];
        case "oldest":
          return ["o", position.publishedAt, position.id];
        case "updated":
          return ["u", position.updatedAt, position.id];
        case "title":
          return ["t", position.title, position.id];
        case "readingTime":
          return ["r", position.words, position.id];
        case "category":
          return ["c", position.category, position.publishedAt, position.id];
        case "author":
          return ["a", position.author, position.publishedAt, position.id];
      }
    }),
  }),
  Schema.annotate({ identifier: "PostCursor" }),
);
export type PostCursor = typeof PostCursor.Type;

/**
 * Query of the published post lists (`listPosts`, `recentPosts`). Posts are
 * ordered by `sort` (newest published first by default, see `PostSort`) and
 * can be filtered by `tag`, `category` (main or extra) and `author`. A
 * `cursor` only fits the `sort` it was created with: otherwise decoding
 * fails (400). Decoding fills in the default `limit` and `sort`; in the
 * generated client both are therefore required (pass
 * `PostPageLimits.defaultLimit` and `"newest"`).
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
  /** The order of the list; `newest` by default. */
  sort: PostSort.annotateKey({
    description: "The order of the list; `newest` if absent.",
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed("newest" as const))),
  /** The `nextCursor` of the previous page; absent for the first page. */
  cursor: Schema.optionalKey(PostCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page, requested with the same " +
      "`sort`; leave out for the first page.",
  }),
  /** Only posts with this tag. */
  tag: Schema.optionalKey(Tag).annotateKey({
    description: "Only posts with this tag.",
  }),
  /** Only posts with this category, as main or extra category. */
  category: Schema.optionalKey(CategorySlug).annotateKey({
    description:
      "Only posts having the category with this slug, as main or extra " +
      "category.",
  }),
  /** Only posts by this author. */
  author: Schema.optionalKey(UserId).annotateKey({
    description: "Only posts by the author with this user id.",
  }),
})
  .check(
    Schema.makeFilter<{
      readonly sort: PostSort;
      readonly cursor?: PostCursorPosition;
    }>(
      ({ sort, cursor }) =>
        cursor === undefined ||
        cursor.sort === sort ||
        "a cursor created with the same sort",
      { expected: "a `cursor` created with the same `sort`" },
    ),
  )
  .annotate({ identifier: "PostPageQuery" });
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
    "One page of published posts in the requested `sort` order (newest " +
    "first by default). `nextCursor` is the position after the last " +
    "returned post, or null on the last page.",
});
export type PostPage = typeof PostPage.Type;
