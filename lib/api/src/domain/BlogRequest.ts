import { UserId } from "#domain/Admin";
import { BlogDescription, BlogSlug, BlogTitle } from "#domain/Blog";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { noNul } from "#domain/Text";
import { Effect, Schema } from "effect";

/** Length and list limits of blog requests. */
export const BlogRequestLimits = {
  /** Length limit of `BlogRequestReason`. */
  reasonMaxLength: 1000,
  /** Most requests `listMyBlogRequests` returns (newest first). */
  myListLimit: 50,
  /** Page size of `listBlogRequests` when `limit` is absent. */
  defaultLimit: 50,
  /** Largest `limit` of `listBlogRequests`. */
  maxLimit: 200,
} as const;

/** The id of a blog request (a UUID). */
export const BlogRequestId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("BlogRequestId"))
  .annotate({
    identifier: "BlogRequestId",
    description: "The id of a blog request (a UUID).",
  });
export type BlogRequestId = typeof BlogRequestId.Type;

/**
 * Where a blog request stands. A request starts `pending` and ends in
 * exactly one of the other states, which are final:
 * - `approved`: an admin created the subblog and made the requester its
 *   editor;
 * - `rejected`: an admin turned it down, optionally with a reason;
 * - `withdrawn`: the requester took it back while it was pending.
 */
export const BlogRequestStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]).annotate({
  identifier: "BlogRequestStatus",
  description:
    "`pending` until decided; then `approved`, `rejected` (by an admin) or " +
    "`withdrawn` (by the requester). The last three are final.",
});
export type BlogRequestStatus = typeof BlogRequestStatus.Type;

/**
 * Why a blog request was rejected: trimmed, 1 to 1000 characters. Shown to
 * the requester.
 */
export const BlogRequestReason = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(BlogRequestLimits.reasonMaxLength),
).annotate({
  identifier: "BlogRequestReason",
  description:
    "Why a blog request was rejected: trimmed, 1 to 1000 characters. " +
    "Shown to the requester.",
});
export type BlogRequestReason = typeof BlogRequestReason.Type;

/** Payload of `POST /blog-requests`: the subblog the user asks for. */
export const CreateBlogRequestPayload = Schema.Struct({
  title: BlogTitle,
  description: BlogDescription,
}).annotate({
  identifier: "CreateBlogRequestPayload",
  description:
    "The title and description the requested subblog gets once approved. " +
    "The slug is chosen by the approving admin.",
});
export type CreateBlogRequestPayload = typeof CreateBlogRequestPayload.Type;

const blogRequestFields = {
  id: BlogRequestId,
  title: BlogTitle,
  description: BlogDescription,
  status: BlogRequestStatus,
  createdAt: IsoDateTimeUtc,
  /**
   * When the request was approved, rejected or withdrawn; `null` while
   * pending.
   */
  decidedAt: Schema.NullOr(IsoDateTimeUtc),
  /** The reason given with the rejection; `null` unless `rejected`. */
  reason: Schema.NullOr(BlogRequestReason),
  /** The subblog created by the approval; `null` unless `approved`. */
  blog: Schema.NullOr(BlogSlug),
};

/** A blog request, as the user who made it sees it. */
export const BlogRequest = Schema.Struct(blogRequestFields).annotate({
  identifier: "BlogRequest",
  description:
    "A request for a subblog, as its requester sees it. `decidedAt` is set " +
    "once approved, rejected or withdrawn; `reason` only for rejected " +
    "requests; `blog` (the created subblog's slug) only for approved ones.",
});
export type BlogRequest = typeof BlogRequest.Type;

/** Who made a blog request, as admins see it. */
export const BlogRequester = Schema.Struct({
  id: UserId,
  /** `preferred_username`; `null` for a deleted account. */
  username: Schema.NullOr(Schema.String),
  /** The full name; `null` for a deleted account. */
  name: Schema.NullOr(Schema.String),
  /** Whether the requester has deleted their account since. */
  deleted: Schema.Boolean,
}).annotate({
  identifier: "BlogRequester",
  description:
    "The user who made a blog request. A deleted account has no username " +
    "and no name.",
});
export type BlogRequester = typeof BlogRequester.Type;

/** A blog request with its requester and decider, as admins see it. */
export const AdminBlogRequest = Schema.Struct({
  ...blogRequestFields,
  requester: BlogRequester,
  /**
   * The moderator who approved or rejected it, or the requester for a
   * withdrawal; `null` while pending or if that account has been deleted
   * since.
   */
  decidedBy: Schema.NullOr(UserId),
}).annotate({
  identifier: "AdminBlogRequest",
  description:
    "A blog request with the requester and `decidedBy`: the moderator who " +
    "approved or rejected it, or the requester for a withdrawal.",
});
export type AdminBlogRequest = typeof AdminBlogRequest.Type;

/** Payload of `POST /admin/blog-requests/:requestId/approve`. */
export const ApproveBlogRequestPayload = Schema.Struct({
  /** Immutable once the subblog exists: it is part of URLs and roles. */
  slug: BlogSlug,
}).annotate({
  identifier: "ApproveBlogRequestPayload",
  description: "The slug of the subblog to create. It cannot change later.",
});
export type ApproveBlogRequestPayload = typeof ApproveBlogRequestPayload.Type;

/** Payload of `POST /admin/blog-requests/:requestId/reject`. */
export const RejectBlogRequestPayload = Schema.Struct({
  /** Why the request is rejected; shown to the requester. Optional. */
  reason: Schema.optionalKey(Schema.NullOr(BlogRequestReason)),
}).annotate({
  identifier: "RejectBlogRequestPayload",
  description:
    "An optional reason (absent or null for none), shown to the requester.",
});
export type RejectBlogRequestPayload = typeof RejectBlogRequestPayload.Type;

/**
 * Query of `GET /admin/blog-requests`: newest first (by `createdAt`, then
 * `id`), no cursor. Decoding fills in the default `limit`; in the generated
 * client `limit` is therefore required (pass
 * `BlogRequestLimits.defaultLimit`).
 */
export const AdminBlogRequestQuery = Schema.Struct({
  /** Only requests in this status; all of them if absent. */
  status: Schema.optionalKey(BlogRequestStatus).annotateKey({
    description: "Only requests in this status; all if absent.",
  }),
  /** Most requests returned, 1 to 200; 50 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BlogRequestLimits.maxLimit }),
  )
    // Described on the key, before the default (see `UserPageQuery`).
    .annotateKey({
      description:
        "Most requests returned, an integer from 1 to 200; 50 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(
        Effect.succeed(BlogRequestLimits.defaultLimit),
      ),
    ),
}).annotate({ identifier: "AdminBlogRequestQuery" });
export type AdminBlogRequestQuery = typeof AdminBlogRequestQuery.Type;
