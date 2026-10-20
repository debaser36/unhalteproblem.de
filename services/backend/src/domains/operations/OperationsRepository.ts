import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#repositories/Sql";

/**
 * What the admin panel shows about the database and the outbox. Numbers
 * Postgres counts in `bigint` are cast to `float8`, which holds them exactly
 * far beyond anything this database reaches, so they arrive as numbers.
 */

const Time = Schema.DateTimeUtcFromDate;
const NullableTime = Schema.NullOr(Time);

export const DatabaseFacts = Schema.Struct({
  postgresVersion: Schema.String,
  databaseName: Schema.String,
  databaseBytes: Schema.Finite,
  startedAt: Time,
  active: Schema.Finite,
  idle: Schema.Finite,
  total: Schema.Finite,
  max: Schema.Finite,
  cacheHitRatio: Schema.NullOr(Schema.Finite),
});
export type DatabaseFacts = typeof DatabaseFacts.Type;

export const TableStats = Schema.Struct({
  name: Schema.String,
  estimatedRows: Schema.Finite,
  totalBytes: Schema.Finite,
  tableBytes: Schema.Finite,
  indexBytes: Schema.Finite,
  sequentialScans: Schema.Finite,
  indexScans: Schema.NullOr(Schema.Finite),
  lastVacuum: NullableTime,
  lastAutovacuum: NullableTime,
  lastAnalyze: NullableTime,
  lastAutoanalyze: NullableTime,
});
export type TableStats = typeof TableStats.Type;

export const MigrationRow = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  appliedAt: Time,
});
export type MigrationRow = typeof MigrationRow.Type;

export const OutboxRow = Schema.Struct({
  id: Schema.Finite,
  topic: Schema.String,
  attempts: Schema.Finite,
  lastError: Schema.NullOr(Schema.String),
  availableAt: Time,
  lockedUntil: NullableTime,
  deadAt: NullableTime,
  createdAt: Time,
});
export type OutboxRow = typeof OutboxRow.Type;

export type OutboxState = "pending" | "dead" | "all";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Connections of this database only; `max` is the server's limit.
  const facts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: DatabaseFacts,
    execute: () => sql`
      SELECT current_setting('server_version') AS postgres_version,
             current_database() AS database_name,
             pg_database_size(current_database())::float8 AS database_bytes,
             pg_postmaster_start_time() AS started_at,
             count(*) FILTER (WHERE a.state = 'active')::float8 AS active,
             count(*) FILTER (WHERE a.state LIKE 'idle%')::float8 AS idle,
             count(a.pid)::float8 AS total,
             current_setting('max_connections')::float8 AS max,
             (SELECT CASE WHEN blks_hit + blks_read = 0 THEN NULL
                          ELSE blks_hit::float8 / (blks_hit + blks_read) END
                FROM pg_stat_database WHERE datname = current_database())
               AS cache_hit_ratio
      FROM (SELECT 1) AS one
      LEFT JOIN pg_stat_activity a ON a.datname = current_database()
    `,
  });

  const tables = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TableStats,
    execute: () => sql`
      SELECT relname AS name,
             n_live_tup::float8 AS estimated_rows,
             pg_total_relation_size(relid)::float8 AS total_bytes,
             pg_table_size(relid)::float8 AS table_bytes,
             pg_indexes_size(relid)::float8 AS index_bytes,
             seq_scan::float8 AS sequential_scans,
             idx_scan::float8 AS index_scans,
             last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC, relname
    `,
  });

  const migrations = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MigrationRow,
    execute: () => sql`
      SELECT migration_id::float8 AS id, name, created_at AS applied_at
      FROM effect_sql_migrations
      ORDER BY migration_id
    `,
  });

  const outbox = SqlSchema.findAll({
    Request: Schema.Struct({ state: Schema.String, limit: Schema.Finite }),
    Result: OutboxRow,
    execute: ({ state, limit }) => sql`
      SELECT id::float8 AS id, topic, attempts, last_error, available_at,
             locked_until, dead_at, created_at
      FROM outbox
      ${
        state === "dead"
          ? sql`WHERE dead_at IS NOT NULL`
          : state === "pending"
            ? sql`WHERE dead_at IS NULL`
            : sql``
      }
      ORDER BY id DESC
      LIMIT ${limit}
    `,
  });

  // What the README tells operators to run by hand: the message is due now,
  // with all its attempts back. A message that is being handled right now
  // loses its lease and may run once more, which handlers tolerate (at
  // least once).
  const retry = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.Finite, now: Time }),
    Result: Schema.Struct({ topic: Schema.String }),
    execute: ({ id, now }) => sql`
      UPDATE outbox
      SET attempts = 0, available_at = ${now}, last_error = NULL,
          dead_at = NULL, locked_until = NULL
      WHERE id = ${id}
      RETURNING topic
    `,
  });

  return OperationsRepository.of({
    // The query always returns its one row.
    facts: facts(undefined).pipe(
      Effect.catchTag("NoSuchElementError", Effect.die),
      dieOnSchemaError,
      Effect.withSpan("OperationsRepository.facts"),
    ),
    tables: tables(undefined).pipe(
      dieOnSchemaError,
      Effect.withSpan("OperationsRepository.tables"),
    ),
    migrations: migrations(undefined).pipe(
      dieOnSchemaError,
      Effect.withSpan("OperationsRepository.migrations"),
    ),
    outbox: (state, limit) =>
      outbox({ state, limit }).pipe(
        dieOnSchemaError,
        Effect.withSpan("OperationsRepository.outbox"),
      ),
    retryOutbox: (id, now) =>
      retry({ id, now }).pipe(
        Effect.map(Option.map(({ topic }) => topic)),
        dieOnSchemaError,
        Effect.withSpan("OperationsRepository.retryOutbox"),
      ),
  });
});

/**
 * Read access to Postgres' statistics and the kernel's outbox table, plus
 * the one write operators do on it (a retry). Used only inside the
 * operations domain.
 */
export class OperationsRepository extends Context.Service<
  OperationsRepository,
  {
    readonly facts: Effect.Effect<DatabaseFacts, SqlError.SqlError>;
    readonly tables: Effect.Effect<
      ReadonlyArray<TableStats>,
      SqlError.SqlError
    >;
    readonly migrations: Effect.Effect<
      ReadonlyArray<MigrationRow>,
      SqlError.SqlError
    >;
    /** The newest `limit` messages in `state`, newest first, without payloads. */
    readonly outbox: (
      state: OutboxState,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<OutboxRow>, SqlError.SqlError>;
    /** Makes the message due at `now` with fresh attempts; its topic, if it exists. */
    readonly retryOutbox: (
      id: number,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<string>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/operations/OperationsRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(OperationsRepository, make);
}
