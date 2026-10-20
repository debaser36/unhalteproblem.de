/**
 * The projects page: the owner's projects, with links to their source code
 * and to the projects themselves, written in place by admins with the same
 * editor (`Document`) and image uploads (`MediaId`) as blog posts.
 */
import { BlogLimits, Tag } from "#domain/Blog";
import { Document } from "#domain/Document";
import { HttpUrl } from "#domain/HttpUrl";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { MediaId } from "#domain/Media";
import { noNul, slugString } from "#domain/Text";
import { Schema } from "effect";

/** Length and range limits of projects. */
export const ProjectLimits = {
  /** Same as `BlogSlugMaxLength`. */
  slugMaxLength: 64,
  titleMaxLength: 120,
  summaryMaxLength: 500,
  /** Largest `position`; the smallest is 0. */
  maxPosition: 10000,
} as const;

/** The id of a project (a UUID). Editing addresses projects by id. */
export const ProjectId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("ProjectId"))
  .annotate({
    identifier: "ProjectId",
    description: "The id of a project (a UUID).",
  });
export type ProjectId = typeof ProjectId.Type;

/**
 * The URL slug of a project, e.g. `type-checker`: 1 to 64 lowercase ASCII
 * letters and digits, in groups separated by single hyphens (the rule of
 * `BlogSlug`). Admins may change it.
 */
export const ProjectSlug = slugString(
  ProjectLimits.slugMaxLength,
  "type-checker",
).annotate({
  identifier: "ProjectSlug",
  description:
    "URL slug of a project, e.g. `type-checker`; 1 to 64 characters, like " +
    "a `BlogSlug`.",
});
export type ProjectSlug = typeof ProjectSlug.Type;

// Validated as already trimmed, like the post fields (see `PostTitle`).

/** The title of a project: trimmed, 1 to 120 characters. */
export const ProjectTitle = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(ProjectLimits.titleMaxLength),
).annotate({
  identifier: "ProjectTitle",
  description: "The title of a project: trimmed, 1 to 120 characters.",
});
export type ProjectTitle = typeof ProjectTitle.Type;

/** The summary (teaser) of a project: trimmed plain text, at most 500 characters. */
export const ProjectSummary = Schema.Trimmed.check(
  noNul,
  Schema.isMaxLength(ProjectLimits.summaryMaxLength),
).annotate({
  identifier: "ProjectSummary",
  description:
    "The summary (teaser) of a project: trimmed plain text, at most 500 " +
    "characters; may be empty.",
});
export type ProjectSummary = typeof ProjectSummary.Type;

/** The tags of a project: `Tag`s, at most 10, without duplicates (like posts). */
export const ProjectTags = Schema.UniqueArray(Tag)
  .check(Schema.isMaxLength(BlogLimits.maxTags))
  .annotate({
    description: "The tags of a project: at most 10, without duplicates.",
  });

/** The state of the project itself (not whether its page is published). */
export const ProjectStatus = Schema.Literals([
  "active",
  "completed",
  "archived",
]).annotate({
  identifier: "ProjectStatus",
  description:
    "The state of the project itself: `active` (worked on), `completed` " +
    "(done, maintained) or `archived` (no longer worked on). Unrelated to " +
    "`published`.",
});
export type ProjectStatus = typeof ProjectStatus.Type;

/** The order of a project among the others: 0 to 10000, smaller first. */
export const ProjectPosition = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: ProjectLimits.maxPosition }),
).annotate({
  identifier: "ProjectPosition",
  description:
    "The order of a project on the page, 0 to 10000, smaller first (after " +
    "the featured ones are sorted first).",
});
export type ProjectPosition = typeof ProjectPosition.Type;

/**
 * The version of a project, for optimistic locking: 1 when created, one more
 * with every saved change.
 */
export const ProjectVersion = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
).annotate({
  identifier: "ProjectVersion",
  description:
    "The version of a project: 1 when created, one more with every saved " +
    "change.",
});
export type ProjectVersion = typeof ProjectVersion.Type;

const listItemFields = {
  id: ProjectId,
  slug: ProjectSlug,
  title: ProjectTitle,
  summary: ProjectSummary,
  tags: ProjectTags,
  status: ProjectStatus,
  /** Featured projects are listed first. */
  featured: Schema.Boolean,
  /** The source code; `null` without a public repository. */
  repoUrl: Schema.NullOr(HttpUrl),
  /** The running project or its homepage; `null` without one. */
  liveUrl: Schema.NullOr(HttpUrl),
  /** The cover image; `null` without one. Shown via `mediaUrl`. */
  coverImage: Schema.NullOr(MediaId),
  updatedAt: IsoDateTimeUtc,
};

/** A published project in a list: everything but its content. */
export const ProjectListItem = Schema.Struct(listItemFields).annotate({
  identifier: "ProjectListItem",
  description: "A published project without its content, for lists.",
});
export type ProjectListItem = typeof ProjectListItem.Type;

/** A published project with its content. Body of `getProject`. */
export const PublishedProject = Schema.Struct({
  ...listItemFields,
  content: Document,
}).annotate({
  identifier: "PublishedProject",
  description: "A published project with its content.",
});
export type PublishedProject = typeof PublishedProject.Type;

const managedFields = {
  ...listItemFields,
  /** Whether the project is on the public page; admins see all. */
  published: Schema.Boolean,
  position: ProjectPosition,
  createdAt: IsoDateTimeUtc,
  /** The version to send back with `updateProject`. */
  version: ProjectVersion,
};

/** A project, published or not, as admins see it, without content. */
export const ManagedProjectListItem = Schema.Struct(managedFields).annotate({
  identifier: "ManagedProjectListItem",
  description:
    "A project, published or not, as admins see it, without content.",
});
export type ManagedProjectListItem = typeof ManagedProjectListItem.Type;

/** A project, published or not, as admins see it, with its content. */
export const ManagedProject = Schema.Struct({
  ...managedFields,
  content: Document,
}).annotate({
  identifier: "ManagedProject",
  description:
    "A project, published or not, as admins see it, with content and " +
    "`version`.",
});
export type ManagedProject = typeof ManagedProject.Type;

const inputFields = {
  slug: ProjectSlug,
  title: ProjectTitle,
  summary: ProjectSummary,
  tags: ProjectTags,
  status: ProjectStatus,
  featured: Schema.Boolean,
  position: ProjectPosition,
  repoUrl: Schema.NullOr(HttpUrl),
  liveUrl: Schema.NullOr(HttpUrl),
  coverImage: Schema.NullOr(MediaId),
  content: Document,
  published: Schema.Boolean,
};

/** Payload of `createProject`: every editable field of a project. */
export const ProjectInput = Schema.Struct(inputFields).annotate({
  identifier: "ProjectInput",
  description: "The editable fields of a project.",
});
export type ProjectInput = typeof ProjectInput.Type;

/** Payload of `updateProject`: the new fields and the version they are based on. */
export const UpdateProjectPayload = Schema.Struct({
  ...inputFields,
  /**
   * The `version` of the project the edit started from. If the project has
   * been saved since, the update fails with `ProjectEditConflict`.
   */
  version: ProjectVersion,
}).annotate({
  identifier: "UpdateProjectPayload",
  description:
    "The editable fields of a project and the `version` the edit is based " +
    "on (optimistic locking).",
});
export type UpdateProjectPayload = typeof UpdateProjectPayload.Type;
