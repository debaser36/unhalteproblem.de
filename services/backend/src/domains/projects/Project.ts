import {
  HttpUrl,
  MediaId,
  ProjectId,
  ProjectSlug,
  ProjectStatus,
  ProjectSummary,
  ProjectTitle,
  Tag,
} from "@unhalteproblem.de/api";
import { Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "#domains/users/User";
import { DocumentColumn } from "#repositories/Columns";

/**
 * The owner's projects, shown on the projects page: a write-up each, with
 * links to the source and to the project itself. Admins write them in place
 * on the website; only published ones are public. Like posts, edits are
 * guarded by a version number.
 */

export { ProjectId, ProjectSlug };

export class ProjectRow extends Model.Class<ProjectRow>("ProjectRow")({
  id: ProjectId,
  slug: ProjectSlug,
  title: ProjectTitle,
  summary: ProjectSummary,
  tags: Schema.Array(Tag),
  status: ProjectStatus,
  featured: Schema.Boolean,
  /** Order on the page among equally featured projects, ascending. */
  position: Schema.Int,
  repoUrl: Schema.NullOr(HttpUrl),
  liveUrl: Schema.NullOr(HttpUrl),
  coverMediaId: Schema.NullOr(MediaId),
  content: DocumentColumn,
  published: Schema.Boolean,
  createdBy: Schema.OptionFromNullOr(UserId).pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  updatedBy: Schema.OptionFromNullOr(UserId),
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  updatedAt: Schema.DateTimeUtcFromDate,
  version: Schema.Int,
}) {}

// Errors: the contract's, so they map to their status codes as they are.
export {
  ProjectEditConflict,
  ProjectNotFound,
  ProjectSlugTaken,
} from "@unhalteproblem.de/api";

// Events

export class ProjectSaved extends Schema.TaggedClass<
  ProjectSaved,
  { readonly brand: unique symbol }
>()("ProjectSaved", {
  projectId: ProjectId,
  version: Schema.Int,
  by: UserId,
}) {}

export class ProjectDeleted extends Schema.TaggedClass<
  ProjectDeleted,
  { readonly brand: unique symbol }
>()("ProjectDeleted", { projectId: ProjectId, by: UserId }) {}

export type ProjectEvent = ProjectSaved | ProjectDeleted;

/** Postgres' unique constraint on project slugs. */
export const projectSlugConstraint = "projects_slug_key";
