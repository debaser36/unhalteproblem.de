import { Role } from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, type Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { Session } from "#repositories/Sessions";
import { dieOnSchemaError } from "#repositories/Sql";

/**
 * A session as the authenticated request needs it: the stored fields, plus
 * what decides about the user's requests right now.
 */
export const AuthenticatedSession = Schema.Struct({
  ...Session.fields,
  roles: Schema.Array(Role),
  restricted: Schema.Boolean,
});
export type AuthenticatedSession = typeof AuthenticatedSession.Type;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The read side of authentication, deliberately across the session and
  // the users domain's tables: every authenticated request needs the
  // session, the roles and the restriction, and fetching them one after
  // another would triple the database round trips of every request. The
  // lateral subquery is `ModerationRepository.accessOf` for the session's
  // user (a test keeps the two in agreement); a user we have no row for
  // gets no roles and is not restricted, as there.
  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({
      idHash: Schema.Uint8Array,
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: AuthenticatedSession,
    execute: ({ idHash, now }) => sql`
      SELECT s.id_hash, s.user_id, s.provider_session_id, s.claims,
             s.created_at, s.expires_at,
             COALESCE(a.roles, '{}') AS roles,
             COALESCE(a.restricted, false) AS restricted
      FROM auth_sessions s
      LEFT JOIN LATERAL (
        SELECT
          ARRAY(
            SELECT r.role FROM user_roles r
            WHERE r.user_id = u.id ORDER BY r.role
          ) AS roles,
          EXISTS (
            SELECT 1 FROM user_restrictions x
            WHERE x.user_id = u.id AND x.lifted_at IS NULL
          ) AS restricted
        FROM users u
        WHERE u.subject = s.user_id
      ) a ON true
      WHERE s.id_hash = ${idHash} AND s.expires_at > ${now}
    `,
  });

  return SessionAccess.of({
    find: Effect.fn("SessionAccess.find")(function* (idHash: Uint8Array) {
      const now = yield* DateTime.now;
      return yield* find({ idHash, now }).pipe(dieOnSchemaError);
    }),
  });
});

/** One query for what `Authentication` needs from a session cookie. */
export class SessionAccess extends Context.Service<
  SessionAccess,
  {
    /**
     * The unexpired session with this id hash, with the user's current
     * roles and whether they are restricted.
     */
    readonly find: (
      idHash: Uint8Array,
    ) => Effect.Effect<Option.Option<AuthenticatedSession>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/auth/SessionAccess") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(SessionAccess, make);
}
