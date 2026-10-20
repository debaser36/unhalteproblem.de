import { Authentication } from "#Authentication";
import {
  ManagedProject,
  ManagedProjectListItem,
  ProjectId,
  ProjectInput,
  UpdateProjectPayload,
} from "#domain/Project";
import { ProjectEditConflict } from "#errors/ProjectEditConflict";
import { ProjectNotFound } from "#errors/ProjectNotFound";
import { ProjectSlugTaken } from "#errors/ProjectSlugTaken";
import { RequireAdmin } from "#groups/Admin";
import { LargeBody } from "#LargeBody";
import {
  CreatedMedia,
  MediaUpload,
  MediaUploadErrors,
  mediaUploadDescription,
} from "#MediaUpload";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** Path parameters of the endpoints for one project. */
const ProjectParams = { projectId: ProjectId };

/**
 * Success of `createProject`: the new `ManagedProject`, with status 201. A
 * one-member union, so the OpenAPI document keeps one `ManagedProject`
 * component (see `CreatedRestriction` in the admin group).
 */
const CreatedProject = Schema.Union([ManagedProject])
  .pipe(HttpApiSchema.status(201))
  .annotate({ description: "The new project." });

// Shared by every endpoint description.
const adminRule = "Requires `admin`. Answers with `Cache-Control: no-store`.";

/**
 * Editing the projects page, in place on the website, for admins. Every
 * endpoint requires a session (`Authentication`, 401) and `admin`
 * (`RequireAdmin`, 403 `Forbidden`), both on the group, so an endpoint added
 * here is protected without further ado. The state-changing endpoints also
 * require `SameOrigin` (403 `Forbidden`), and those taking a whole project
 * `LargeBody` (a larger body limit). The backend answers every endpoint
 * with `Cache-Control: no-store`.
 *
 * Projects are addressed by id here, because admins may change the slug.
 * Images go to the shared media store (scope `projects`) and are served by
 * `media.getMedia`.
 *
 * Middleware order: group middlewares are added after the endpoints, so
 * they run first: `Authentication` (401), then `RequireAdmin` (403), then
 * the endpoint's `SameOrigin` (403), then `LargeBody`. Only admins get to
 * send a large body.
 */
export class ProjectAdminGroup extends HttpApiGroup.make("projectAdmin")
  .add(
    HttpApiEndpoint.get("listManagedProjects", "/admin/projects", {
      success: Schema.Array(ManagedProjectListItem).annotate({
        description:
          "Every project, published or not, in the order of the public " +
          "page.",
      }),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the projects for editing",
        description:
          adminRule +
          " Returns every project, published or not, without content, in " +
          "the order of the public page: featured first, then by " +
          "`position` (ascending), then by `updatedAt` (newest first).",
      }),
    ),
    HttpApiEndpoint.get("getManagedProject", "/admin/projects/:projectId", {
      params: ProjectParams,
      success: ManagedProject,
      error: ProjectNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a project for editing",
        description:
          adminRule +
          " Returns the project, published or not, with its content and " +
          "`version`. Answers 404 `ProjectNotFound` for an unknown id.",
      }),
    ),
    HttpApiEndpoint.post("createProject", "/admin/projects", {
      payload: ProjectInput,
      success: CreatedProject,
      error: ProjectSlugTaken,
    })
      .middleware(LargeBody)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Create a project",
          description:
            adminRule +
            " Requires a same-origin request. Creates the project (version " +
            "1), published or not as `published` says, and answers 201 " +
            "with it. Answers 409 `ProjectSlugTaken` if another project " +
            "has the slug.",
        }),
      ),
    HttpApiEndpoint.put("updateProject", "/admin/projects/:projectId", {
      params: ProjectParams,
      payload: UpdateProjectPayload,
      success: ManagedProject,
      error: [ProjectNotFound, ProjectSlugTaken, ProjectEditConflict],
    })
      .middleware(LargeBody)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Update a project",
          description:
            adminRule +
            " Requires a same-origin request. Replaces every editable field " +
            "(including `published`), increments `version` and answers " +
            "with the saved project. Optimistic locking: `version` must be " +
            "the project's current version (the one the edit started " +
            "from); otherwise nothing is saved and it answers 409 " +
            "`ProjectEditConflict` with the current version. Answers 409 " +
            "`ProjectSlugTaken` if another project has the slug and 404 " +
            "`ProjectNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.delete("deleteProject", "/admin/projects/:projectId", {
      params: ProjectParams,
      success: HttpApiSchema.NoContent.annotate({
        description: "The project is deleted.",
      }),
      error: ProjectNotFound,
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Delete a project",
          description:
            adminRule +
            " Requires a same-origin request. Deletes the project, " +
            "published or not, irreversibly. Its images stay. Answers 404 " +
            "`ProjectNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.post("uploadProjectMedia", "/admin/projects/media", {
      payload: MediaUpload,
      success: CreatedMedia,
      error: MediaUploadErrors,
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Upload an image for a project",
          description:
            adminRule +
            " Requires a same-origin request. Same limits and answers as " +
            "`blogEditor.uploadMedia`. " +
            mediaUploadDescription,
        }),
      ),
  )
  // Both protect every endpoint above. Added after them, so they run before
  // the endpoints' own middlewares; `Authentication` last, so it runs first
  // and answers 401 before `RequireAdmin` answers 403.
  .middleware(RequireAdmin)
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Project admin",
      description:
        "Editing the projects page and uploading its images, for admins.",
    }),
  ) {}
