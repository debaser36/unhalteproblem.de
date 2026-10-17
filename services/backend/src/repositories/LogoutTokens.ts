import { Context, DateTime, Effect, Layer } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import { deleteExpiredRows } from "./Sql.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return LogoutTokens.of({
    remember: Effect.fn("LogoutTokens.remember")(function* (
      jti: string,
      expiresAt: DateTime.Utc,
    ) {
      const inserted = yield* sql`
        INSERT INTO auth_logout_tokens (jti, expires_at)
        VALUES (${jti}, ${DateTime.toDateUtc(expiresAt)})
        ON CONFLICT (jti) DO NOTHING
        RETURNING jti
      `;
      return inserted.length > 0;
    }),

    deleteExpired: deleteExpiredRows(sql, "auth_logout_tokens").pipe(
      Effect.withSpan("LogoutTokens.deleteExpired"),
    ),
  });
});

/**
 * The `jti`s of back-channel logout tokens already processed, so a replayed
 * token is rejected.
 */
export class LogoutTokens extends Context.Service<
  LogoutTokens,
  {
    /**
     * Records a logout token's `jti` until `expiresAt` (the token's `exp`).
     * `true` if it is new, `false` if it was seen before (a replay). The
     * check and the insert are one statement, so concurrent deliveries of
     * the same token can't both get `true`.
     */
    readonly remember: (
      jti: string,
      expiresAt: DateTime.Utc,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /** Forgets expired `jti`s and returns how many there were. */
    readonly deleteExpired: Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/LogoutTokens") {
  /** Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`). */
  static readonly layer = Layer.effect(LogoutTokens, make);
}
