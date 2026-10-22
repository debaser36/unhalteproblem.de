import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite";
import { Layer } from "effect";
import { clientOptions, migrationLoader } from "#infrastructure/Database";

/**
 * A fresh in-memory Postgres (PGlite) with all migrations applied, for tests.
 * Provides `SqlClient` like `DatabaseLive`, with the same client options.
 *
 * Every build of the layer is a new, empty database: provide it per test
 * for isolation, or share it with `layer(DatabaseTest)` from
 * `@effect/vitest` and keep the tests independent of each other's rows.
 *
 * Test support only: production code must not import `#testing/*`, or
 * PGlite ends up in the bundle.
 */
export const DatabaseTest = PgliteMigrator.layer({
  loader: migrationLoader,
}).pipe(Layer.provideMerge(PgliteClient.layer(clientOptions)));
