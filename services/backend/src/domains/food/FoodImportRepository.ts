import {
  Context,
  type DateTime,
  Effect,
  Layer,
  type Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";

/** A row of `food_imports`. */
export const ImportRow = Schema.Struct({
  id: Schema.String,
  country: Schema.Literals(["DE", "NZ"]),
  source: Schema.Literals(["openPrices", "statsNz", "priceEstimates"]),
  status: Schema.Literals(["queued", "running", "succeeded", "failed"]),
  requestedBy: Schema.NullOr(Schema.String),
  requestedAt: Schema.DateTimeUtcFromDate,
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  items: Schema.Int,
  prices: Schema.Int,
  error: Schema.NullOr(Schema.String),
});
export type ImportRow = typeof ImportRow.Type;

/** Postgres' partial unique index: one active import per country and source. */
export const activeImportConstraint = "food_imports_active_key";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: ImportRow,
    execute: (row) => sql`INSERT INTO food_imports ${sql.insert(row)}`,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ImportRow,
    execute: (id) => sql`SELECT * FROM food_imports WHERE id = ${id}`,
  });

  const findActive = SqlSchema.findOneOption({
    Request: Schema.Struct({ country: Schema.String, source: Schema.String }),
    Result: ImportRow,
    execute: ({ country, source }) => sql`
      SELECT * FROM food_imports
      WHERE country = ${country} AND source = ${source}
        AND status IN ('queued', 'running')
    `,
  });

  const list = SqlSchema.findAll({
    Request: Schema.Int,
    Result: ImportRow,
    execute: (limit) => sql`
      SELECT * FROM food_imports ORDER BY requested_at DESC, id LIMIT ${limit}
    `,
  });

  const start = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: ImportRow,
    // A queued import starts; a running one whose worker died starts again.
    execute: ({ id, now }) => sql`
      UPDATE food_imports SET status = 'running', started_at = ${now}
      WHERE id = ${id} AND status IN ('queued', 'running')
      RETURNING *
    `,
  });

  const finish = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      now: Schema.DateTimeUtcFromDate,
      status: Schema.Literals(["succeeded", "failed"]),
      items: Schema.Int,
      prices: Schema.Int,
      error: Schema.NullOr(Schema.String),
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, now, status, items, prices, error }) => sql`
      UPDATE food_imports
      SET status = ${status}, finished_at = ${now}, items = ${items},
          prices = ${prices}, error = ${error}
      WHERE id = ${id}
      AND status = 'running'
      RETURNING id
    `,
  });

  const failStale = SqlSchema.void({
    Request: Schema.Struct({
      country: Schema.String,
      source: Schema.String,
      before: Schema.DateTimeUtcFromDate,
      now: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ country, source, before, now }) => sql`
      UPDATE food_imports
      SET status = 'failed', finished_at = ${now}, error = 'stale'
      WHERE country = ${country} AND source = ${source}
        AND status IN ('queued', 'running') AND requested_at < ${before}
    `,
  });

  return FoodImportRepository.of({
    insert: (row) =>
      insert(row).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.insert"),
      ),
    find: (id) =>
      find(id).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.find"),
      ),
    findActive: (country, source) =>
      findActive({ country, source }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.findActive"),
      ),
    list: (limit) =>
      list(limit).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.list"),
      ),
    start: (id, now) =>
      start({ id, now }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.start"),
      ),
    finish: (result) =>
      finish(result).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.finish"),
      ),
    failStale: (country, source, before, now) =>
      failStale({ country, source, before, now }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodImportRepository.failStale"),
      ),
  });
});

/** Storage of import jobs (`food_imports`). Used only inside the food domain. */
export class FoodImportRepository extends Context.Service<
  FoodImportRepository,
  {
    /** Fails with a `UniqueViolation` of `activeImportConstraint`; run it in a savepoint. */
    readonly insert: (row: ImportRow) => Effect.Effect<void, SqlError.SqlError>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<ImportRow>, SqlError.SqlError>;
    /** The queued or running import of this country and source, if any. */
    readonly findActive: (
      country: ImportRow["country"],
      source: ImportRow["source"],
    ) => Effect.Effect<Option.Option<ImportRow>, SqlError.SqlError>;
    /** The newest imports first. */
    readonly list: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<ImportRow>, SqlError.SqlError>;
    /** Marks a queued (or interrupted) import as running; `None` if it is done. */
    readonly start: (
      id: string,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<ImportRow>, SqlError.SqlError>;
    readonly finish: (result: {
      readonly id: string;
      readonly now: DateTime.Utc;
      readonly status: "succeeded" | "failed";
      readonly items: number;
      readonly prices: number;
      readonly error: string | null;
    }) => Effect.Effect<
      Option.Option<{ readonly id: string }>,
      SqlError.SqlError
    >;
    /**
     * Gives up on the active import of this country and source if it was
     * requested before `before`.
     */
    readonly failStale: (
      country: ImportRow["country"],
      source: ImportRow["source"],
      before: DateTime.Utc,
      now: DateTime.Utc,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/food/FoodImportRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(FoodImportRepository, make);
}
