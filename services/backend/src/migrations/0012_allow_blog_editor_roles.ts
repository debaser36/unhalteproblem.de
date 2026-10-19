import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Roles of the form `blogEditor:<slug>`, besides the fixed `normalUser`,
 * `admin` and `superAdmin`.
 *
 * A `blogEditor:<slug>` role lets its holder edit the posts of the subblog
 * `<slug>`. superAdmins grant and revoke it through the admin API like any
 * other role, so it is stored in user_roles and logged in user_role_changes
 * under its full name.
 *
 * The slug is 1 to 64 characters of lowercase ASCII letters and digits in
 * groups joined by single hyphens: `^[a-z0-9]+(-[a-z0-9]+)*$`, the same rule
 * as the `Role` schema of the contract. With the 11 characters of the
 * `blogEditor:` prefix, a role is at most 75 characters long.
 *
 * This replaces user_roles_role_check (0003) and
 * user_role_changes_role_check (0004) under the same names. Adding a fixed
 * role still means a new migration that replaces both again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `~` is case sensitive (`~*` would not be), and the pattern is anchored
  // at both ends. Postgres regular expressions treat newlines as ordinary
  // characters by default, so `$` matches only at the end of the value, and
  // ranges like `a-z` are by code point, independent of the collation.
  //
  // The new check only widens the old one, so every existing row satisfies
  // it and re-adding it cannot fail. DROP and ADD are one ALTER TABLE
  // statement, so no row can be written without a check in between.
  //
  // Validated right away instead of NOT VALID (README, "Long-running
  // migrations"): both tables hold a few rows per user, and DROP CONSTRAINT
  // takes the ACCESS EXCLUSIVE lock anyway, which a VALIDATE CONSTRAINT in
  // the same migration transaction would not release. The scan of these
  // small tables takes milliseconds.
  yield* sql`
    ALTER TABLE user_roles
      DROP CONSTRAINT user_roles_role_check,
      ADD CONSTRAINT user_roles_role_check
        CHECK (
          role IN ('normalUser', 'admin', 'superAdmin')
          OR (
            role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'
            AND char_length(role) <= 75
          )
        )
  `;

  // The log takes the same roles, so that every grant and revocation can be
  // logged.
  yield* sql`
    ALTER TABLE user_role_changes
      DROP CONSTRAINT user_role_changes_role_check,
      ADD CONSTRAINT user_role_changes_role_check
        CHECK (
          role IN ('normalUser', 'admin', 'superAdmin')
          OR (
            role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'
            AND char_length(role) <= 75
          )
        )
  `;
});
