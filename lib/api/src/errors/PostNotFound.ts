import { Schema } from "effect";

/**
 * The subblog has no post with the requested slug or id (404). Drafts
 * count as missing on the public endpoints.
 */
export class PostNotFound extends Schema.TaggedError<
  PostNotFound,
  { readonly brand: unique symbol }
>()(
  "PostNotFound",
  {
    /** The requested post: its slug (public endpoints) or id (editing). */
    post: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No post with this slug or id exists in the subblog.",
  },
) {}
