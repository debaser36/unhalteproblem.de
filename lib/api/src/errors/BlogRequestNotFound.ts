import { BlogRequestId } from "#domain/BlogRequest";
import { Schema } from "effect";

/**
 * No blog request has the requested `BlogRequestId` (404). Also the answer
 * for another user's request, so ids of strangers' requests do not leak.
 */
export class BlogRequestNotFound extends Schema.TaggedError<
  BlogRequestNotFound,
  { readonly brand: unique symbol }
>()(
  "BlogRequestNotFound",
  { requestId: BlogRequestId },
  {
    httpApiStatus: 404,
    description: "No blog request with this id exists.",
  },
) {}
