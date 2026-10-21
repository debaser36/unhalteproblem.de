import {
  BlogDescription,
  BlogRequestId,
  BlogRequestReason,
  BlogRequestStatus,
  BlogSlug,
  BlogTitle,
} from "@unhalteproblem.de/api";
import { type DateTime, Option, Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "#domains/users/User";
import { BlogId } from "./Blog.ts";

/**
 * Requests for a subblog of one's own. Any user asks with a title and a
 * description; an admin or superAdmin approves (choosing the slug, which
 * creates the subblog and makes the requester its editor) or rejects, with
 * an optional reason the requester sees. A user has at most one pending
 * request and may withdraw it.
 */

export { BlogRequestId, BlogRequestStatus };

/** A request as stored. */
export class BlogRequestRow extends Model.Class<BlogRequestRow>(
  "BlogRequestRow",
)({
  id: BlogRequestId,
  requesterId: UserId.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  title: BlogTitle.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  description: BlogDescription.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  status: BlogRequestStatus,
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  /** When it was approved, rejected or withdrawn; none while pending. */
  decidedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
  /** The moderator, or the requester for a withdrawal. */
  decidedBy: Schema.OptionFromNullOr(UserId),
  /** Why it was rejected; only for rejected requests. */
  reason: Schema.OptionFromNullOr(BlogRequestReason),
  /** The subblog created by the approval. */
  blogId: Schema.OptionFromNullOr(BlogId),
}) {}

// Errors: the contract's, so they map to their status codes as they are.
export {
  BlogRequestAlreadyPending,
  BlogRequestNotFound,
  BlogRequestNotPending,
} from "@unhalteproblem.de/api";

// Events

export class BlogRequested extends Schema.TaggedClass<
  BlogRequested,
  { readonly brand: unique symbol }
>()("BlogRequested", { requestId: BlogRequestId, by: UserId }) {}

export class BlogRequestApproved extends Schema.TaggedClass<
  BlogRequestApproved,
  { readonly brand: unique symbol }
>()("BlogRequestApproved", {
  requestId: BlogRequestId,
  blog: BlogSlug,
  requester: UserId,
  by: UserId,
}) {}

export class BlogRequestRejected extends Schema.TaggedClass<
  BlogRequestRejected,
  { readonly brand: unique symbol }
>()("BlogRequestRejected", {
  requestId: BlogRequestId,
  requester: UserId,
  by: UserId,
}) {}

export class BlogRequestWithdrawn extends Schema.TaggedClass<
  BlogRequestWithdrawn,
  { readonly brand: unique symbol }
>()("BlogRequestWithdrawn", { requestId: BlogRequestId, by: UserId }) {}

export type BlogRequestEvent =
  | BlogRequested
  | BlogRequestApproved
  | BlogRequestRejected
  | BlogRequestWithdrawn;

// Rules

/** A request decided at `at` by `by`: approved, rejected or withdrawn. */
export const decide = (
  request: BlogRequestRow,
  decision:
    | { readonly status: "approved"; readonly blogId: BlogId }
    | {
        readonly status: "rejected";
        readonly reason: Option.Option<BlogRequestReason>;
      }
    | { readonly status: "withdrawn" },
  by: UserId,
  at: DateTime.Utc,
): BlogRequestRow =>
  BlogRequestRow.make({
    ...request,
    status: decision.status,
    decidedAt: Option.some(at),
    decidedBy: Option.some(by),
    reason: decision.status === "rejected" ? decision.reason : Option.none(),
    blogId:
      decision.status === "approved"
        ? Option.some(decision.blogId)
        : Option.none(),
  });

/** Postgres' partial unique index allowing one pending request per user. */
export const onePendingConstraint = "blog_requests_one_pending_per_user";
