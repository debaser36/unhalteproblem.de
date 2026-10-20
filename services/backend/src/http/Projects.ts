import { Api } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { ProjectQueries } from "#domains/projects/ProjectQueries";
import { revalidate } from "./CacheControl.ts";
import { toProjectListItem, toPublishedProject } from "./ProjectViews.ts";

/** The public projects page. */
export const ProjectsHandlers = HttpApiBuilder.group(
  Api,
  "projects",
  Effect.fn(function* (handlers) {
    const queries = yield* ProjectQueries;
    return handlers
      .handle("listProjects", () =>
        queries.listPublished.pipe(
          Effect.map((projects) => projects.map(toProjectListItem)),
          revalidate,
        ),
      )
      .handle("getProject", ({ params }) =>
        queries
          .getPublished(params.project)
          .pipe(Effect.map(toPublishedProject), revalidate),
      );
  }),
);
