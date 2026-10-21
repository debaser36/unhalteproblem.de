import { BlogRequestId, BlogRequestStatus } from "#domain/BlogRequest";
import { Schema } from "effect";

/**
 * The blog request is already decided or withdrawn (409), so it can no
 * longer be approved, rejected or withdrawn. `status` is its current one.
 */
export class BlogRequestNotPending extends Schema.TaggedError<
  BlogRequestNotPending,
  { readonly brand: unique symbol }
>()(
  "BlogRequestNotPending",
  { requestId: BlogRequestId, status: BlogRequestStatus },
  {
    httpApiStatus: 409,
    description: "The blog request is not pending any more.",
  },
) {}
