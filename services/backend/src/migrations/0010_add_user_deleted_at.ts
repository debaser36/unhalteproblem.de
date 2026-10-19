import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Account deletion: a user who deleted their account stays as an anonymised
 * row.
 *
 * The row is kept so that the ids in audit_log and the user's restrictions
 * keep pointing at something, and so that `subject` (Keycloak's `sub`) is
 * still known while the Keycloak account is being deleted. The application
 * clears username, name and email, sets email_verified to false and removes
 * the user's roles.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // When the user deleted their account. NULL for every user who has not.
  // The application sets it from the Effect clock, like the other
  // timestamps of users. A user with a deleted_at can no longer log in or
  // use sessions.
  //
  // Nullable without a default, so existing rows need no rewrite. No index:
  // nothing queries users by it.
  yield* sql`ALTER TABLE users ADD COLUMN deleted_at timestamptz NULL`;

  // A deleted user is really anonymised: no profile data is left on the
  // row. Adding the constraint validates the existing rows, which all have
  // deleted_at NULL, so it cannot fail on existing data. The row stays
  // identified by id and subject, which are not personal data in the sense
  // of this check.
  yield* sql`
    ALTER TABLE users
      ADD CONSTRAINT users_deleted_check
        CHECK (
          deleted_at IS NULL
          OR (
            username IS NULL
            AND name IS NULL
            AND email IS NULL
            AND NOT email_verified
          )
        )
  `;
});
