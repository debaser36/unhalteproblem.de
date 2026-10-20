import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
} from "@effect/platform-node";
import { PgClient, PgMigrator } from "@effect/sql-pg";
import { Config, Duration, Layer, String as Str } from "effect";
import { DatabaseConfig } from "#Config";
import createAuthTables from "#migrations/0001_create_auth_tables";
import createUsers from "#migrations/0002_create_users";
import createUserRoles from "#migrations/0003_create_user_roles";
import addUserModeration from "#migrations/0004_add_user_moderation";
import createOutbox from "#migrations/0005_create_outbox";
import createContactMessages from "#migrations/0006_create_contact_messages";
import dropSessionIdToken from "#migrations/0007_drop_session_id_token";
import indexUsersCreatedAt from "#migrations/0008_index_users_created_at";
import createAuditLog from "#migrations/0009_create_audit_log";
import addUserDeletedAt from "#migrations/0010_add_user_deleted_at";
import usersCreatedAtMilliseconds from "#migrations/0011_users_created_at_milliseconds";
import allowBlogEditorRoles from "#migrations/0012_allow_blog_editor_roles";
import createBlogsAndMedia from "#migrations/0013_create_blogs_and_media";
import createProjects from "#migrations/0014_create_projects";
import auditAdminInsights from "#migrations/0015_audit_admin_insights";

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
  "0004_add_user_moderation": addUserModeration,
  "0005_create_outbox": createOutbox,
  "0006_create_contact_messages": createContactMessages,
  "0007_drop_session_id_token": dropSessionIdToken,
  "0008_index_users_created_at": indexUsersCreatedAt,
  "0009_create_audit_log": createAuditLog,
  "0010_add_user_deleted_at": addUserDeletedAt,
  "0011_users_created_at_milliseconds": usersCreatedAtMilliseconds,
  "0012_allow_blog_editor_roles": allowBlogEditorRoles,
  "0013_create_blogs_and_media": createBlogsAndMedia,
  "0014_create_projects": createProjects,
  "0015_audit_admin_insights": auditAdminInsights,
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
    Config.map(({ statementTimeout, ...config }) => ({
      ...config,
      ...clientOptions,
      applicationName: "unhalteproblem-backend",
      // Session defaults, sent when a connection is opened. A transaction
      // left open (a stuck fiber, a lost client) would otherwise hold its
      // locks and its pooled connection until Postgres notices the socket.
      startupParameters: {
        statement_timeout: String(Duration.toMillis(statementTimeout)),
        idle_in_transaction_session_timeout: "60000",
      },
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
