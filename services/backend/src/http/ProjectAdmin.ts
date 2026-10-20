import { Api } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { ProjectCommands } from "#domains/projects/ProjectCommands";
import { ProjectQueries } from "#domains/projects/ProjectQueries";
import { toMediaInfo } from "./BlogViews.ts";
import { noStore } from "./CacheControl.ts";
import { toManagedProject, toManagedProjectListItem } from "./ProjectViews.ts";
import { uploadedFile } from "./Upload.ts";

/**
 * Writing projects in place, for admins. The group's `RequireAdmin`
 * provides the proof the commands and queries require.
 */
export const ProjectAdminHandlers = HttpApiBuilder.group(
  Api,
  "projectAdmin",
  Effect.fn(function* (handlers) {
    const commands = yield* ProjectCommands;
    const queries = yield* ProjectQueries;
    return handlers
      .handle("listManagedProjects", () =>
        queries.listAll.pipe(
          Effect.map((projects) => projects.map(toManagedProjectListItem)),
          noStore,
        ),
      )
      .handle("getManagedProject", ({ params }) =>
        queries
          .get(params.projectId)
          .pipe(Effect.map(toManagedProject), noStore),
      )
      .handle("createProject", ({ payload }) =>
        commands.create(payload).pipe(Effect.map(toManagedProject), noStore),
      )
      .handle("updateProject", ({ params, payload: { version, ...input } }) =>
        commands
          .update(params.projectId, input, version)
          .pipe(Effect.map(toManagedProject), noStore),
      )
      .handle("deleteProject", ({ params }) =>
        commands.delete(params.projectId),
      )
      .handle("uploadProjectMedia", ({ payload }) =>
        Effect.flatMap(uploadedFile(payload), commands.uploadImage).pipe(
          Effect.map(toMediaInfo),
          noStore,
        ),
      );
  }),
);
