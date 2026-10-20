import { Schema } from "effect";

/**
 * No project with the requested slug or id exists (404). Unpublished
 * projects count as missing on the public endpoints.
 */
export class ProjectNotFound extends Schema.TaggedError<
  ProjectNotFound,
  { readonly brand: unique symbol }
>()(
  "ProjectNotFound",
  {
    /** The requested project: its slug (public endpoints) or id (admin). */
    project: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No project with this slug or id exists.",
  },
) {}
