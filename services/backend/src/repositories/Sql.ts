import { DateTime, Effect, type Schema } from "effect";
import type { SqlClient, SqlError, Statement } from "effect/sql";

/**
 * Turns schema errors into defects. The repositories only read rows they
 * wrote themselves, so a row that doesn't decode (or a value that doesn't
 * encode) is a bug, not a failure callers should handle. `SqlError` stays
 * typed.
 */
export const dieOnSchemaError = <A, R>(
  self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError, R>,
): Effect.Effect<A, SqlError.SqlError, R> =>
  Effect.catchTag(self, "SchemaError", Effect.die);

/** Runs a `DELETE` statement and returns how many rows it removed. */
export const countDeleted = (
  sql: SqlClient.SqlClient,
  deleteStatement: Statement.Fragment,
) =>
  sql<{ readonly count: number }>`
    WITH deleted AS (${deleteStatement} RETURNING 1)
    SELECT count(*)::int AS count FROM deleted
  `.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

/**
 * Deletes the rows of `table` whose `expires_at` is not after the Effect
 * clock's current time, and returns how many it deleted.
 */
export const deleteExpiredRows = (
  sql: SqlClient.SqlClient,
  table: "auth_login_attempts" | "auth_sessions" | "auth_logout_tokens",
) =>
  Effect.flatMap(DateTime.now, (now) =>
    countDeleted(
      sql,
      sql`DELETE FROM ${sql(table)} WHERE expires_at <= ${DateTime.toDateUtc(now)}`,
    ),
  );
