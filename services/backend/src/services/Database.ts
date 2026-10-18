import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
} from "@effect/platform-node";
import { PgClient, PgMigrator } from "@effect/sql-pg";
import { Config, Layer, String as Str } from "effect";
import { DatabaseConfig } from "#Config";
import createAuthTables from "#migrations/0001_create_auth_tables";
import createUsers from "#migrations/0002_create_users";
import createUserRoles from "#migrations/0003_create_user_roles";

/**
 * Every migration, keyed `<id>_<name>` like its file in `src/migrations/`.
 *
 * Imported statically instead of read from the directory at runtime: the
 * service is bundled into a single file and runs in a read-only container.
 * A test checks that this record matches the folder.
 */
export const migrations = {
  "0001_create_auth_tables": createAuthTables,
  "0002_create_users": createUsers,
  "0003_create_user_roles": createUserRoles,
};

/** Loads {@link migrations} in id order. */
export const migrationLoader = PgMigrator.fromRecord(migrations);

/**
 * Client options shared by the Postgres and the PGlite (test) client.
 *
 * Columns are snake_case in SQL and camelCase in TypeScript: result columns
 * and identifiers passed through `sql(...)`/`sql.insert(...)` are converted.
 * Nested JSON is left alone, so jsonb values keep their keys (OIDC claims
 * such as `preferred_username`).
 */
export const clientOptions = {
  transformQueryNames: Str.camelToSnake,
  transformResultNames: Str.snakeToCamel,
  transformJson: false,
} as const;

const PgLive = PgClient.layerConfig(
  DatabaseConfig.pipe(
    Config.map((config) => ({
      ...config,
      ...clientOptions,
      applicationName: "unhalteproblem-backend",
    })),
  ),
);

// PgMigrator can dump the schema with pg_dump, hence the process and file
// system services. No schema directory is configured, so it never does.
const MigratorServices = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const MigrationsLive = PgMigrator.layer({ loader: migrationLoader }).pipe(
  Layer.provide(MigratorServices),
);

/**
 * The Postgres database from `POSTGRES_*`, with all pending migrations
 * applied before anything else uses it. Provides `SqlClient` (and
 * `PgClient`); repositories only depend on `SqlClient`.
 *
 * Fails at startup if the database is unreachable or a migration fails.
 * Pending migrations run in one transaction, and concurrent starts are
 * serialised by a lock on the migrations table.
 */
export const DatabaseLive = MigrationsLive.pipe(Layer.provideMerge(PgLive));
