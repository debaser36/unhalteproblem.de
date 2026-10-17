import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Browser login state: logins in flight, logged-in sessions and the ids of
 * back-channel logout tokens already processed.
 *
 * Cookies only carry random values; the tables store their SHA-256 hashes,
 * so a database dump alone doesn't let anyone take over a session.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Lives for about ten minutes, from the redirect to the OpenID Provider
  // until the browser comes back to the callback. Taken exactly once.
  yield* sql`
    CREATE TABLE auth_login_attempts (
      id_hash bytea NOT NULL,
      state text NOT NULL,
      nonce text NOT NULL,
      code_verifier text NOT NULL,
      return_to text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      CONSTRAINT auth_login_attempts_id_hash_pkey PRIMARY KEY (id_hash),
      CONSTRAINT auth_login_attempts_id_hash_check
        CHECK (octet_length(id_hash) = 32)
    )
  `;
  yield* sql`
    CREATE INDEX auth_login_attempts_expires_at_idx
      ON auth_login_attempts (expires_at)
  `;

  // user_id is the OIDC `sub`, provider_session_id Keycloak's `sid` (used by
  // back-channel logout), id_token is only kept as `id_token_hint` for
  // RP-initiated logout, and claims holds the profile subset shown in the UI.
  yield* sql`
    CREATE TABLE auth_sessions (
      id_hash bytea NOT NULL,
      user_id text NOT NULL,
      provider_session_id text NULL,
      id_token text NOT NULL,
      claims jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      CONSTRAINT auth_sessions_id_hash_pkey PRIMARY KEY (id_hash),
      CONSTRAINT auth_sessions_id_hash_check
        CHECK (octet_length(id_hash) = 32)
    )
  `;
  yield* sql`CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id)`;
  // Partial: sessions without a provider session never match a logout token.
  yield* sql`
    CREATE INDEX auth_sessions_provider_session_id_idx
      ON auth_sessions (provider_session_id)
      WHERE provider_session_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at)
  `;

  // A logout token's `jti`, kept until the token itself expires, so a
  // replayed token is recognised.
  yield* sql`
    CREATE TABLE auth_logout_tokens (
      jti text NOT NULL,
      expires_at timestamptz NOT NULL,
      CONSTRAINT auth_logout_tokens_jti_pkey PRIMARY KEY (jti)
    )
  `;
  yield* sql`
    CREATE INDEX auth_logout_tokens_expires_at_idx
      ON auth_logout_tokens (expires_at)
  `;
});
