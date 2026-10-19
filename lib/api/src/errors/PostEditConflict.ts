import { PostVersion } from "#domain/Blog";
import { Schema } from "effect";

/**
 * The post has been saved since the editor loaded it (409): the `version`
 * sent with the update is not the current one. Reload the post and reapply
 * the changes.
 */
export class PostEditConflict extends Schema.TaggedError<
  PostEditConflict,
  { readonly brand: unique symbol }
>()(
  "PostEditConflict",
  {
    /** The version saved in the meantime; reload the post to merge. */
    currentVersion: PostVersion,
  },
  {
    httpApiStatus: 409,
    description: "The post was saved by someone else since this edit started.",
  },
) {}
