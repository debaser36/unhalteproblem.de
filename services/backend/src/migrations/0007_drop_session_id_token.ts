import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Sessions no longer keep a copy of the user's ID token.
 *
 * The column held the token only to send it as `id_token_hint` at
 * RP-initiated logout. The application stops using it in the same change.
 *
 * DESTRUCTIVE and irreversible by design: this project has no down
 * migrations, and the tokens in the dropped column are gone for good.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The repository owner confirmed this drop. Discarding the data is safe:
  // the column is only a copy of a credential the identity provider can
  // issue again at the next login, and nothing else reads it. Sessions
  // themselves are kept and stay valid.
  //
  // Dropping is also safe for the running application. The new version
  // neither reads nor writes id_token, and an old version that still
  // INSERTed it (NOT NULL, no default) would fail once the column is gone.
  // That cannot happen here: the backend runs as a single container that is
  // stopped and replaced, and migrations run at startup of the new version,
  // so no old writer exists afterwards. A deployment with overlapping old
  // and new instances would instead have to make the column nullable first
  // and drop it in a later migration (expand/contract).
  //
  // DROP COLUMN only marks the column as dropped, so it needs no table
  // rewrite. It takes a brief ACCESS EXCLUSIVE lock on auth_sessions.
  yield* sql`ALTER TABLE auth_sessions DROP COLUMN id_token`;
});
