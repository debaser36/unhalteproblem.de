import { Authorized, type ProjectInput } from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import {
  type InvalidUpload,
  type MediaTooLarge,
  projectsScope,
  type StoredMedia,
  type UnsupportedMedia,
} from "#domains/media/Media";
import { MediaCommands } from "#domains/media/MediaCommands";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { isUniqueViolation } from "#repositories/Columns";
import {
  ProjectDeleted,
  ProjectEditConflict,
  ProjectId,
  ProjectNotFound,
  ProjectRow,
  ProjectSaved,
  projectSlugConstraint,
  ProjectSlugTaken,
} from "./Project.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

/** The row's fields that come from what the admin wrote. */
const fromInput = (input: ProjectInput) => ({
  slug: input.slug,
  title: input.title,
  summary: input.summary,
  tags: input.tags,
  status: input.status,
  featured: input.featured,
  position: input.position,
  repoUrl: input.repoUrl,
  liveUrl: input.liveUrl,
  coverMediaId: input.coverImage,
  content: input.content,
  published: input.published,
});

const make = Effect.gen(function* () {
  const repository = yield* ProjectRepository;
  const users = yield* UserDirectory;
  const media = yield* MediaCommands;
  const audit = yield* AuditCommands;
  const transaction = yield* Transaction;

  const actor = Effect.flatMap(Authorized("admin"), (proof) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users)),
  );

  // A slug taken by another project fails the statement; inside a savepoint
  // that rolls back only the statement (see `BlogCommands`).
  const save = (
    statement: Effect.Effect<void, SqlError.SqlError>,
    slug: string,
  ) =>
    transaction
      .run(statement)
      .pipe(
        Effect.catchIf(isUniqueViolation(projectSlugConstraint), () =>
          Effect.fail(new ProjectSlugTaken({ slug })),
        ),
      );

  const reread = Effect.fnUntraced(function* (id: ProjectId) {
    const project = yield* repository.find(id);
    if (Option.isNone(project)) {
      return yield* Effect.die(
        new Error("Project vanished inside its transaction"),
      );
    }
    return project.value;
  });

  const lock = Effect.fnUntraced(function* (id: ProjectId) {
    const project = yield* repository.find(id, { lock: true });
    if (Option.isNone(project))
      return yield* new ProjectNotFound({ project: id });
    return project.value;
  });

  return ProjectCommands.of({
    create: Effect.fn("ProjectCommands.create")(function* (
      input: ProjectInput,
    ) {
      const by = yield* actor;
      const now = yield* DateTime.now;
      const id = ProjectId.make(crypto.randomUUID());
      yield* save(
        repository.insert(
          ProjectRow.make({
            id,
            ...fromInput(input),
            createdBy: Option.some(by),
            updatedBy: Option.some(by),
            createdAt: now,
            updatedAt: now,
            version: 1,
          }),
        ),
        input.slug,
      );
      yield* DomainEvent.record(
        new ProjectSaved({ projectId: id, version: 1, by }),
      );
      yield* audit.record({
        action: "project_created",
        actor: Option.some(by),
        target: Option.none(),
        detail: input.slug,
      });
      return yield* reread(id);
    }, Command.boundary(transaction)),

    update: Effect.fn("ProjectCommands.update")(function* (
      id: ProjectId,
      input: ProjectInput,
      version: number,
    ) {
      const by = yield* actor;
      const current = yield* lock(id);
      if (current.version !== version) {
        return yield* new ProjectEditConflict({
          currentVersion: current.version,
        });
      }
      const now = yield* DateTime.now;
      const next = current.version + 1;
      yield* save(
        repository.update(
          ProjectRow.make({
            ...current,
            ...fromInput(input),
            updatedBy: Option.some(by),
            updatedAt: now,
            version: next,
          }),
        ),
        input.slug,
      );
      yield* DomainEvent.record(
        new ProjectSaved({ projectId: id, version: next, by }),
      );
      yield* audit.record({
        action: "project_updated",
        actor: Option.some(by),
        target: Option.none(),
        detail: input.slug,
      });
      return yield* reread(id);
    }, Command.boundary(transaction)),

    delete: Effect.fn("ProjectCommands.delete")(function* (id: ProjectId) {
      const by = yield* actor;
      const project = yield* lock(id);
      yield* repository.delete(id);
      yield* DomainEvent.record(new ProjectDeleted({ projectId: id, by }));
      yield* audit.record({
        action: "project_deleted",
        actor: Option.some(by),
        target: Option.none(),
        detail: project.slug,
      });
    }, Command.boundary(transaction)),

    uploadImage: Effect.fn("ProjectCommands.uploadImage")(function* (
      bytes: Uint8Array,
    ) {
      const by = yield* actor;
      return yield* media.store({
        scope: projectsScope,
        bytes,
        uploadedBy: by,
      });
    }, Command.boundary(transaction)),
  });
});

/**
 * The commands of the projects domain; all of them for admins.
 *
 * @effect-expect-leaking Authorized<"admin">
 * Requiring the proof in every method is the point: whoever calls one
 * must have checked the role (see "Authorization" in the README).
 */
export class ProjectCommands extends Context.Service<
  ProjectCommands,
  {
    readonly create: (
      input: ProjectInput,
    ) => Effect.Effect<ProjectRow, ProjectSlugTaken, Authorized<"admin">>;
    /** Saves an edit made from `version`; fails if someone saved in between. */
    readonly update: (
      id: ProjectId,
      input: ProjectInput,
      version: number,
    ) => Effect.Effect<
      ProjectRow,
      ProjectNotFound | ProjectSlugTaken | ProjectEditConflict,
      Authorized<"admin">
    >;
    readonly delete: (
      id: ProjectId,
    ) => Effect.Effect<void, ProjectNotFound, Authorized<"admin">>;
    /** Stores an image for the project pages. */
    readonly uploadImage: (
      bytes: Uint8Array,
    ) => Effect.Effect<
      StoredMedia,
      InvalidUpload | MediaTooLarge | UnsupportedMedia,
      Authorized<"admin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/projects/ProjectCommands") {
  /** Needs `ProjectRepository`, `UserDirectory`, `MediaCommands`, `AuditCommands` and `Transaction`. */
  static readonly layer = Layer.effect(ProjectCommands, make);
}
