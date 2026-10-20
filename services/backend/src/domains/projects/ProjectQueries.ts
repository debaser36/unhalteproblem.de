import { Authorized } from "@unhalteproblem.de/api";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import {
  type ProjectId,
  ProjectNotFound,
  type ProjectRow,
  type ProjectSlug,
} from "./Project.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* ProjectRepository;
  return ProjectQueries.of({
    listPublished: repository.listPublished.pipe(
      Query.boundary,
      Effect.withSpan("ProjectQueries.listPublished"),
    ),

    getPublished: Effect.fn("ProjectQueries.getPublished")(function* (
      slug: ProjectSlug,
    ) {
      const project = yield* repository.findPublished(slug);
      if (Option.isNone(project))
        return yield* new ProjectNotFound({ project: slug });
      return project.value;
    }, Query.boundary),

    listAll: Authorized("admin").pipe(
      Effect.andThen(repository.listAll),
      Query.boundary,
      Effect.withSpan("ProjectQueries.listAll"),
    ),

    get: Effect.fn("ProjectQueries.get")(function* (id: ProjectId) {
      yield* Authorized("admin");
      const project = yield* repository.find(id);
      if (Option.isNone(project))
        return yield* new ProjectNotFound({ project: id });
      return project.value;
    }, Query.boundary),
  });
});

/** The reads of the projects domain: published projects for everyone, all of them for admins. */
export class ProjectQueries extends Context.Service<
  ProjectQueries,
  {
    readonly listPublished: Effect.Effect<ReadonlyArray<ProjectRow>>;
    readonly getPublished: (
      slug: ProjectSlug,
    ) => Effect.Effect<ProjectRow, ProjectNotFound>;
    readonly listAll: Effect.Effect<
      ReadonlyArray<ProjectRow>,
      never,
      Authorized<"admin">
    >;
    readonly get: (
      id: ProjectId,
    ) => Effect.Effect<ProjectRow, ProjectNotFound, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/projects/ProjectQueries") {
  /** Needs `ProjectRepository`. */
  static readonly layer = Layer.effect(ProjectQueries, make);
}
