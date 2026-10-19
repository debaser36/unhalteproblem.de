import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * users.created_at is stored at millisecond precision.
 *
 * The admin user list pages by keyset on (created_at, id), and its cursor
 * carries created_at as epoch milliseconds. timestamptz has microseconds: a
 * row with sub-millisecond precision would sort after the cursor made from
 * its own (truncated) created_at, so the next page would return it again,
 * and with `limit=1` the list would never advance. The application always
 * writes created_at from the JS clock, which has millisecond precision; only
 * a hand-written INSERT (for example with `now()`) can violate this.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // NOT VALID on purpose: the constraint is enforced for every new and
  // updated row, but the existing rows are not scanned, so the deploy can
  // neither fail on an old row nor hold a long lock on users (a validating
  // ADD CONSTRAINT scans the table under an ACCESS EXCLUSIVE lock). Rows
  // written by the application satisfy it anyway.
  //
  // An operator may check the old rows later with
  //   ALTER TABLE users VALIDATE CONSTRAINT users_created_at_milliseconds_check
  // which only takes a SHARE UPDATE EXCLUSIVE lock, so reads and writes
  // continue. It fails if an old row has microseconds; fix that row first.
  yield* sql`
    ALTER TABLE users
      ADD CONSTRAINT users_created_at_milliseconds_check
        CHECK (created_at = date_trunc('milliseconds', created_at))
        NOT VALID
  `;
});
