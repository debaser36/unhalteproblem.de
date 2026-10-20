import {
  ProjectListItem,
  ProjectSlug,
  PublishedProject,
} from "#domain/Project";
import { ProjectNotFound } from "#errors/ProjectNotFound";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/**
 * The public, read-only side of the projects page: the published projects.
 * Unpublished ones never appear here.
 *
 * Public on purpose (no `Authentication`): the projects page is public
 * content, read by anonymous visitors. Both endpoints are GETs that only
 * return published data, so there is nothing to protect.
 */
export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("listProjects", "/projects", {
      success: Schema.Array(ProjectListItem).annotate({
        description:
          "Every published project: featured first, then by `position` " +
          "ascending, then most recently updated first.",
      }),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the projects",
        description:
          "Public. Returns every published project without its content: " +
          "featured ones first, then by `position` (ascending), then by " +
          "`updatedAt` (newest first).",
      }),
    ),
    HttpApiEndpoint.get("getProject", "/projects/:project", {
      params: { project: ProjectSlug },
      success: PublishedProject,
      error: ProjectNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a project",
        description:
          "Public. Returns the published project with its content; 404 " +
          "`ProjectNotFound` for an unknown slug or an unpublished project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Projects",
      description:
        "The published projects of the projects page, with links to their " +
        "source code and to the projects themselves.",
    }),
  ) {}
