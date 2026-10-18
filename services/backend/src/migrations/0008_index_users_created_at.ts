import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * An index for the admin user list, which pages through all users by keyset
 * in creation order.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Serves the paging query of the admin user list:
  //
  //   SELECT * FROM users
  //   WHERE (created_at, id) > ($createdAt, $id::uuid)
  //   ORDER BY created_at, id
  //   LIMIT $n
  //
  // The WHERE is left out for the first page; the values are those of the
  // last row of the previous page.
  //
  // Both columns are indexed, in this order. The ORDER BY sorts by
  // (created_at, id), and only an index on exactly that key list returns the
  // rows already sorted, so LIMIT stops after n rows instead of sorting the
  // table. The row comparison needs the same key list: Postgres turns
  // (created_at, id) > (a, b) into a range condition on the index, so each
  // page starts at its place in the index without reading the rows before
  // it. id is the tie-breaker for equal created_at values, which keeps the
  // order total and the pages free of gaps and repeats.
  //
  // A plain CREATE INDEX blocks writes to users while it builds. That is
  // fine: the table is small today, so the build takes a moment, and the
  // lock only delays logins that insert or update a user. It is not
  // CREATE INDEX CONCURRENTLY because Postgres rejects that inside a
  // transaction block, and pending migrations run in one transaction.
  yield* sql`
    CREATE INDEX users_created_at_id_idx
      ON users (created_at, id)
  `;
});
