import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Transactional outbox: work that must happen because a state change
 * happened, such as sending a mail or notifying another system.
 *
 * The application inserts a row in the same transaction as the state change,
 * so either both are committed or neither is. A background worker then
 * claims rows and handles them, at least once: a worker can crash after the
 * side effect and before it marks the row done, so handlers must tolerate
 * running twice. A handled row is deleted.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per pending job. topic names the handler, payload is its input
  // (jsonb, whatever the topic's schema encodes).
  //
  // A worker claims a row by setting locked_until (a lease) and incrementing
  // attempts in one UPDATE. A row whose lease ran out is claimed again, which
  // is how work of a crashed worker is picked up. A failed attempt stores a
  // short reason in last_error, which must not contain personal data, and
  // moves available_at forward (backoff). When attempts run out, dead_at is
  // set: the row stays for inspection and is never claimed again.
  //
  // The timestamps have no default: the application sets them from the
  // Effect clock, like the timestamps of users. This keeps leases and
  // backoff testable with a test clock. There are no foreign keys: a job may
  // outlive the rows it talks about.
  //
  // id is generated and orders the claims, so rows of a topic are handled
  // roughly in the order they were written.
  yield* sql`
    CREATE TABLE outbox (
      id bigint GENERATED ALWAYS AS IDENTITY,
      topic text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      available_at timestamptz NOT NULL,
      locked_until timestamptz NULL,
      attempts integer NOT NULL DEFAULT 0,
      last_error text NULL,
      dead_at timestamptz NULL,
      CONSTRAINT outbox_id_pkey PRIMARY KEY (id),
      CONSTRAINT outbox_topic_check CHECK (char_length(topic) >= 1),
      CONSTRAINT outbox_attempts_check CHECK (attempts >= 0)
    )
  `;

  // Serves the claim query:
  //
  //   WHERE topic = $1 AND dead_at IS NULL AND available_at <= $now
  //     AND (locked_until IS NULL OR locked_until < $now)
  //   ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED
  //
  // Partial on dead_at IS NULL, so dead rows, which accumulate and are never
  // claimed, cost nothing here. locked_until is not part of the index: it is
  // a cheap filter on the few rows that match, and updating it on every
  // claim would turn each claim into an index write. The index finds the
  // due rows of the topic, the executor sorts them by id; both are small
  // since rows are deleted once handled.
  yield* sql`
    CREATE INDEX outbox_topic_available_at_id_idx
      ON outbox (topic, available_at, id)
      WHERE dead_at IS NULL
  `;

  // No index for purging old dead rows (dead_at). They are rare, by design
  // an exception that someone looks at, so the table stays small and a
  // purge by dead_at is a scan of a small table. Add the index if dead rows
  // ever pile up.
});
