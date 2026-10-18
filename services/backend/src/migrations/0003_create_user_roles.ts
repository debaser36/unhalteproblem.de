import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Roles for authorization: flat (no hierarchy), and a user can hold several.
 *
 * Every user gets `normalUser` when they register, in the transaction that
 * inserts them into `users`. `admin` and `superAdmin` have no management UI:
 * an operator grants them with a manual INSERT and revokes them with a
 * DELETE (see the backend README).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per granted role. The primary key (user_id, role) rejects a
  // duplicate grant and, leading with user_id, also serves the lookup of a
  // user's roles and the cascading delete. Authorization resolves the session's
  // subject through users_subject_key and then this key, so no further index
  // is needed.
  //
  // role is limited to the known roles by a check constraint. Adding a role
  // means a new migration that drops and re-adds user_roles_role_check with
  // the extended list (and the matching change to the role schema in code).
  //
  // granted_at is set by the application from the Effect clock, like the
  // timestamps of users. Unlike those, it defaults to now(): operators grant
  // roles by hand and shouldn't have to supply it.
  yield* sql`
    CREATE TABLE user_roles (
      user_id uuid NOT NULL,
      role text NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT user_roles_user_id_role_pkey PRIMARY KEY (user_id, role),
      CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT user_roles_role_check
        CHECK (role IN ('normalUser', 'admin', 'superAdmin'))
    )
  `;

  // Users who registered before roles existed get normalUser as of their
  // registration, as if this table had existed then.
  yield* sql`
    INSERT INTO user_roles (user_id, role, granted_at)
    SELECT id, 'normalUser', created_at FROM users
  `;
});
