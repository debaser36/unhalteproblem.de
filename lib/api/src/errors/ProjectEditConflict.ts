import { ProjectVersion } from "#domain/Project";
import { Schema } from "effect";

/**
 * The project has been saved since the editor loaded it (409): the
 * `version` sent with the update is not the current one. Reload the project
 * and reapply the changes.
 */
export class ProjectEditConflict extends Schema.TaggedError<
  ProjectEditConflict,
  { readonly brand: unique symbol }
>()(
  "ProjectEditConflict",
  {
    /** The version saved in the meantime; reload the project to merge. */
    currentVersion: ProjectVersion,
  },
  {
    httpApiStatus: 409,
    description:
      "The project was saved by someone else since this edit started.",
  },
) {}
