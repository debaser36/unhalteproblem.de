import { Context, Effect, Layer, type Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlModel, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";
import { type ProjectId, ProjectRow, type ProjectSlug } from "./Project.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* SqlModel.makeRepository(ProjectRow, {
    tableName: "projects",
    spanPrefix: "ProjectRepository",
    idColumn: "id",
  });

  // The page's order; `projects_featured_position_updated_at_id_idx` serves
  // it for the published ones.
  const order = sql`ORDER BY featured DESC, position, updated_at DESC, id`;

  const list = SqlSchema.findAll({
    Request: Schema.Struct({ publishedOnly: Schema.Boolean }),
    Result: ProjectRow,
    execute: ({ publishedOnly }) => sql`
      SELECT * FROM projects ${publishedOnly ? sql`WHERE published` : sql``} ${order}
    `,
  });

  const findPublished = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProjectRow,
    execute: (slug) =>
      sql`SELECT * FROM projects WHERE slug = ${slug} AND published`,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String, lock: Schema.Boolean }),
    Result: ProjectRow,
    execute: ({ id, lock }) => sql`
      SELECT * FROM projects WHERE id = ${id} ${lock ? sql`FOR NO KEY UPDATE` : sql``}
    `,
  });

  return ProjectRepository.of({
    listPublished: list({ publishedOnly: true }).pipe(
      dieOnSchemaError,
      Effect.withSpan("ProjectRepository.listPublished"),
    ),
    listAll: list({ publishedOnly: false }).pipe(
      dieOnSchemaError,
      Effect.withSpan("ProjectRepository.listAll"),
    ),
    findPublished: (slug) =>
      findPublished(slug).pipe(
        dieOnSchemaError,
        Effect.withSpan("ProjectRepository.findPublished"),
      ),
    find: (id, options) =>
      find({ id, lock: options?.lock === true }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ProjectRepository.find"),
      ),
    insert: (project) =>
      projects
        .insertVoid(ProjectRow.insert.make(project))
        .pipe(dieOnSchemaError),
    update: (project) =>
      projects
        .updateVoid(ProjectRow.update.make(project))
        .pipe(dieOnSchemaError),
    delete: (id) => projects.delete(id).pipe(dieOnSchemaError),
  });
});

/** Storage of projects (`projects`). Used only inside the projects domain. */
export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    /** The published projects, in the page's order. */
    readonly listPublished: Effect.Effect<
      ReadonlyArray<ProjectRow>,
      SqlError.SqlError
    >;
    /** Every project, unpublished ones included, in the page's order. */
    readonly listAll: Effect.Effect<
      ReadonlyArray<ProjectRow>,
      SqlError.SqlError
    >;
    readonly findPublished: (
      slug: ProjectSlug,
    ) => Effect.Effect<Option.Option<ProjectRow>, SqlError.SqlError>;
    /** A project by id; `lock` keeps it locked until the transaction ends. */
    readonly find: (
      id: ProjectId,
      options?: { readonly lock?: boolean },
    ) => Effect.Effect<Option.Option<ProjectRow>, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly insert: (
      project: ProjectRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Fails with a `UniqueViolation` if the slug is taken; run it in a savepoint. */
    readonly update: (
      project: ProjectRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly delete: (id: ProjectId) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/projects/ProjectRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(ProjectRepository, make);
}
