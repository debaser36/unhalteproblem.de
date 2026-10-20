import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { Schema } from "effect";

// Byte sizes and counters are `bigint` in Postgres, which the driver returns
// as strings; the backend converts them to numbers. They are safe integers
// (`Schema.Natural`): 2^53 bytes is 8 PiB.

/** Connections to the database (`pg_stat_activity`, `max_connections`). */
export const DatabaseConnections = Schema.Struct({
  /** Connections running a query. */
  active: Schema.Natural,
  /** Connections waiting for a query. */
  idle: Schema.Natural,
  /** All client connections to this database, in any state. */
  total: Schema.Natural,
  /** The server's `max_connections`. */
  max: Schema.Natural,
}).annotate({
  identifier: "DatabaseConnections",
  description:
    "Client connections to the database: active, idle, all (`total`) and " +
    "the server's `max_connections` (`max`).",
});
export type DatabaseConnections = typeof DatabaseConnections.Type;

/** One table of the `public` schema, with its size and statistics. */
export const DatabaseTable = Schema.Struct({
  name: Schema.String,
  /** Postgres' estimate of the live rows (`n_live_tup`), not an exact count. */
  estimatedRows: Schema.Natural,
  /** Table, TOAST and indexes (`pg_total_relation_size`). */
  totalBytes: Schema.Natural,
  /** Table and TOAST, without indexes (`pg_table_size`). */
  tableBytes: Schema.Natural,
  /** All indexes of the table (`pg_indexes_size`). */
  indexBytes: Schema.Natural,
  /** Sequential scans since the statistics were reset (`seq_scan`). */
  sequentialScans: Schema.Natural,
  /** Index scans (`idx_scan`); `null` if the table has no index. */
  indexScans: Schema.NullOr(Schema.Natural),
  lastVacuum: Schema.NullOr(IsoDateTimeUtc),
  lastAutovacuum: Schema.NullOr(IsoDateTimeUtc),
  lastAnalyze: Schema.NullOr(IsoDateTimeUtc),
  lastAutoanalyze: Schema.NullOr(IsoDateTimeUtc),
}).annotate({
  identifier: "DatabaseTable",
  description:
    "A table of the `public` schema: estimated rows, sizes in bytes, scan " +
    "counters and the last (auto) vacuum and analyze, null if never.",
});
export type DatabaseTable = typeof DatabaseTable.Type;

/** A migration the backend has applied (the SQL migrator's table). */
export const AppliedMigration = Schema.Struct({
  id: Schema.Natural,
  name: Schema.String,
  appliedAt: IsoDateTimeUtc,
}).annotate({
  identifier: "AppliedMigration",
  description: "A database migration the backend has applied.",
});
export type AppliedMigration = typeof AppliedMigration.Type;

/**
 * Body of `GET /admin/database`: what the server and its catalog say about
 * the database. Statistics only, never user data.
 */
export const DatabaseOverview = Schema.Struct({
  /** The server's version (`server_version`), e.g. `17.5`. */
  postgresVersion: Schema.String,
  databaseName: Schema.String,
  /** Size of the whole database on disk (`pg_database_size`). */
  databaseBytes: Schema.Natural,
  /** When the server started (`pg_postmaster_start_time()`). */
  startedAt: IsoDateTimeUtc,
  connections: DatabaseConnections,
  /**
   * Share of block reads served from the buffer cache,
   * `blks_hit / (blks_hit + blks_read)` of `pg_stat_database`, 0 to 1;
   * `null` before the first read.
   */
  cacheHitRatio: Schema.NullOr(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  /** The tables of the `public` schema, largest (`totalBytes`) first. */
  tables: Schema.Array(DatabaseTable),
  /** The applied migrations, by `id` ascending. */
  migrations: Schema.Array(AppliedMigration),
}).annotate({
  identifier: "DatabaseOverview",
  description:
    "The database server's version, size, start time, connections and " +
    "cache hit ratio, the tables of the `public` schema (largest first) " +
    "and the applied migrations (oldest first).",
});
export type DatabaseOverview = typeof DatabaseOverview.Type;
