import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Audit actions of the admin insights, and indexes for reading the log.
 *
 * Two new actions, written by the admin insights commands in their
 * transaction:
 *
 * - `outbox_retried`: an admin retried an outbox message. detail is the
 *   message's topic.
 * - `contact_message_deleted`: an admin deleted a stored contact message.
 *   No detail: what a message holds (sender, address, text) is personal
 *   data, which the log never keeps.
 *
 * This replaces audit_log_action_check (0009) under the same name. Adding
 * an action still means a new migration that replaces it again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The new check only widens the old one, so every existing row satisfies
  // it and re-adding it cannot fail. DROP and ADD are one ALTER TABLE
  // statement, so no row can be written without a check in between.
  //
  // Validated right away instead of NOT VALID (README, "Long-running
  // migrations"): DROP CONSTRAINT takes the ACCESS EXCLUSIVE lock anyway,
  // which a VALIDATE CONSTRAINT in the same migration transaction would not
  // release, and checking a text column against a list is a quick scan even
  // for a year of logins.
  yield* sql`
    ALTER TABLE audit_log
      DROP CONSTRAINT audit_log_action_check,
      ADD CONSTRAINT audit_log_action_check
        CHECK (
          action IN (
            'login',
            'logout',
            'login_refused',
            'role_granted',
            'role_revoked',
            'user_restricted',
            'restriction_lifted',
            'account_deleted',
            'outbox_retried',
            'contact_message_deleted'
          )
        )
  `;

  // Serves the admin view of what one user did or had done to them, newest
  // first, paged by keyset on id:
  //
  //   SELECT * FROM audit_log
  //   WHERE (actor_id = $user OR target_id = $user) AND id < $lastId
  //   ORDER BY id DESC
  //   LIMIT $n
  //
  // audit_log_target_id_idx (0009) covers the target half; a btree is read
  // backwards just as well, so DESC needs no index of its own. Without an
  // index on actor_id, the OR could only be answered by scanning the whole
  // log. With both, Postgres combines the two indexes (BitmapOr) and sorts
  // just this user's rows, which stay few even for a year of logins.
  // Partial like the target index: rows without an actor (the system,
  // operators) are never read by actor.
  //
  // Where reading at most n rows per page matters, the same result comes
  // from two ordered index scans:
  //
  //   (… WHERE actor_id = $user AND id < $lastId ORDER BY id DESC LIMIT $n)
  //   UNION
  //   (… WHERE target_id = $user AND id < $lastId ORDER BY id DESC LIMIT $n)
  //   ORDER BY id DESC LIMIT $n
  yield* sql`
    CREATE INDEX audit_log_actor_id_idx
      ON audit_log (actor_id, id)
      WHERE actor_id IS NOT NULL
  `;

  // Serves the admin view of one action, newest first:
  //
  //   SELECT * FROM audit_log
  //   WHERE action = $action AND id < $lastId
  //   ORDER BY id DESC
  //   LIMIT $n
  //
  // Without it, Postgres walks the primary key backwards and skips rows of
  // other actions. That is quick for login, which fills most of the log,
  // and a scan of the whole year for rare actions like account_deleted.
  // With action first and id second, the index returns exactly the page.
  //
  // A plain CREATE INDEX blocks writes to audit_log while it builds, which
  // takes well under a second for a log of this size.
  yield* sql`
    CREATE INDEX audit_log_action_id_idx
      ON audit_log (action, id)
  `;
});
