import {
  Context,
  DateTime,
  Effect,
  Layer,
  type Option,
  Redacted,
  Schema,
} from "effect";
import { Model } from "effect/schema";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { countDeleted, deleteExpiredRows, dieOnSchemaError } from "./Sql.ts";

/**
 * The profile claims kept with a session, named as in the ID token. Stored
 * as jsonb; anything else in the column is dropped when decoding.
 */
export const SessionClaims = Schema.Struct({
  preferred_username: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  email_verified: Schema.optionalKey(Schema.Boolean),
});
export type SessionClaims = typeof SessionClaims.Type;

/**
 * A logged-in browser session, keyed by the SHA-256 hash of the session
 * cookie's value.
 */
export class Session extends Model.Class<Session>("Session")({
  idHash: Schema.Uint8Array,
  /** The OIDC `sub`. */
  userId: Schema.String,
  /** Keycloak's `sid`, matched by back-channel logout. */
  providerSessionId: Schema.OptionFromNullOr(Schema.String),
  /**
   * Only for `id_token_hint` at logout. A credential: redacted so it never
   * shows up in logs.
   */
  idToken: Model.Sensitive(Schema.RedactedFromValue(Schema.String)),
  // jsonb comes back parsed; it's written as JSON text, which Postgres
  // converts to jsonb on insert.
  claims: Model.Field({
    select: SessionClaims,
    insert: Schema.fromJsonString(SessionClaims),
    json: SessionClaims,
  }),
  createdAt: Model.GeneratedByDb(Schema.DateTimeUtcFromDate),
  expiresAt: Schema.DateTimeUtcFromDate,
}) {}

export interface NewSession {
  /** SHA-256 of the session cookie's value (32 bytes). */
  readonly idHash: Uint8Array;
  readonly userId: string;
  readonly providerSessionId: Option.Option<string>;
  readonly idToken: string;
  readonly claims: SessionClaims;
  readonly expiresAt: DateTime.Utc;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: Session.insert,
    execute: (row) => sql`INSERT INTO auth_sessions ${sql.insert(row)}`,
  });

  const findUnexpired = SqlSchema.findOneOption({
    Request: Schema.Struct({
      idHash: Schema.Uint8Array,
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: Session,
    execute: ({ idHash, now }) => sql`
      SELECT * FROM auth_sessions
      WHERE id_hash = ${idHash} AND expires_at > ${now}
    `,
  });

  const deleteById = SqlSchema.findOneOption({
    Request: Schema.Uint8Array,
    Result: Session,
    execute: (idHash) => sql`
      DELETE FROM auth_sessions
      WHERE id_hash = ${idHash}
      RETURNING *
    `,
  });

  return Sessions.of({
    create: Effect.fn("Sessions.create")(function* (session: NewSession) {
      yield* insert(
        Session.insert.make({
          ...session,
          idToken: Redacted.make(session.idToken),
        }),
      ).pipe(dieOnSchemaError);
    }),

    find: Effect.fn("Sessions.find")(function* (idHash: Uint8Array) {
      const now = yield* DateTime.now;
      return yield* findUnexpired({ idHash, now }).pipe(dieOnSchemaError);
    }),

    delete: Effect.fn("Sessions.delete")((idHash: Uint8Array) =>
      deleteById(idHash).pipe(dieOnSchemaError),
    ),

    deleteByProviderSession: Effect.fn("Sessions.deleteByProviderSession")(
      (providerSessionId: string) =>
        countDeleted(
          sql,
          sql`DELETE FROM auth_sessions WHERE provider_session_id = ${providerSessionId}`,
        ),
    ),

    deleteByUser: Effect.fn("Sessions.deleteByUser")((userId: string) =>
      countDeleted(
        sql,
        sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`,
      ),
    ),

    deleteExpired: deleteExpiredRows(sql, "auth_sessions").pipe(
      Effect.withSpan("Sessions.deleteExpired"),
    ),
  });
});

/**
 * Logged-in browser sessions. Expiry is checked against the Effect clock,
 * the same clock that computes `expiresAt`.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly create: (
      session: NewSession,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** The session, unless it doesn't exist or has expired. */
    readonly find: (
      idHash: Uint8Array,
    ) => Effect.Effect<Option.Option<Session>, SqlError.SqlError>;
    /**
     * Removes the session and returns it, expired or not, so logout can
     * still send its ID token as `id_token_hint`.
     */
    readonly delete: (
      idHash: Uint8Array,
    ) => Effect.Effect<Option.Option<Session>, SqlError.SqlError>;
    /**
     * Removes every session of a provider session (back-channel logout with
     * `sid`) and returns how many there were.
     */
    readonly deleteByProviderSession: (
      providerSessionId: string,
    ) => Effect.Effect<number, SqlError.SqlError>;
    /**
     * Removes every session of a user (back-channel logout with only `sub`)
     * and returns how many there were.
     */
    readonly deleteByUser: (
      userId: string,
    ) => Effect.Effect<number, SqlError.SqlError>;
    /** Removes expired sessions and returns how many there were. */
    readonly deleteExpired: Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/Sessions") {
  /** Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`). */
  static readonly layer = Layer.effect(Sessions, make);
}
