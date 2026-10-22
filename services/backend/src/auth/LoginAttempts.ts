import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Model } from "effect/schema";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { deleteExpiredRows, dieOnSchemaError } from "#infrastructure/Sql";

/**
 * A browser login in flight, from the redirect to the OpenID Provider until
 * the callback. Keyed by the SHA-256 hash of the login cookie's value.
 */
export class LoginAttempt extends Model.Class<LoginAttempt>("LoginAttempt")({
  idHash: Schema.Uint8Array,
  state: Schema.String,
  nonce: Schema.String,
  // The PKCE secret: redacted so it never shows up in logs.
  codeVerifier: Model.Sensitive(Schema.RedactedFromValue(Schema.String)),
  // Where to send the browser after the login.
  returnTo: Schema.String,
  createdAt: Model.GeneratedByDb(Schema.DateTimeUtcFromDate),
  expiresAt: Schema.DateTimeUtcFromDate,
}) {}

export interface NewLoginAttempt {
  /** SHA-256 of the login cookie's value (32 bytes). */
  readonly idHash: Uint8Array;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly expiresAt: DateTime.Utc;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: LoginAttempt.insert,
    execute: (row) => sql`INSERT INTO auth_login_attempts ${sql.insert(row)}`,
  });

  const deleteById = SqlSchema.findOneOption({
    Request: Schema.Uint8Array,
    Result: LoginAttempt,
    execute: (idHash) => sql`
      DELETE FROM auth_login_attempts
      WHERE id_hash = ${idHash}
      RETURNING *
    `,
  });

  return LoginAttempts.of({
    create: Effect.fn("LoginAttempts.create")(function* (
      attempt: NewLoginAttempt,
    ) {
      yield* insert(
        LoginAttempt.insert.make({
          ...attempt,
          codeVerifier: Redacted.make(attempt.codeVerifier),
        }),
      ).pipe(dieOnSchemaError);
    }),

    // Deleting and returning in one statement makes the attempt single-use
    // even with concurrent callbacks. An expired attempt is deleted too, but
    // not returned.
    take: Effect.fn("LoginAttempts.take")(function* (idHash: Uint8Array) {
      const now = yield* DateTime.now;
      const attempt = yield* deleteById(idHash).pipe(dieOnSchemaError);
      return Option.filter(attempt, (a) =>
        DateTime.isGreaterThan(a.expiresAt, now),
      );
    }),

    deleteExpired: deleteExpiredRows(sql, "auth_login_attempts").pipe(
      Effect.withSpan("LoginAttempts.deleteExpired"),
    ),
  });
});

/**
 * Logins in flight. Expiry is checked against the Effect clock, the same
 * clock that computes `expiresAt`.
 */
export class LoginAttempts extends Context.Service<
  LoginAttempts,
  {
    readonly create: (
      attempt: NewLoginAttempt,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /**
     * Removes the attempt and returns it if it hasn't expired yet. A second
     * `take` of the same id returns `None`.
     */
    readonly take: (
      idHash: Uint8Array,
    ) => Effect.Effect<Option.Option<LoginAttempt>, SqlError.SqlError>;
    /** Removes expired attempts and returns how many there were. */
    readonly deleteExpired: Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/LoginAttempts") {
  /** Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`). */
  static readonly layer = Layer.effect(LoginAttempts, make);
}
