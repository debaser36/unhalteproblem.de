import { assert, describe, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { SqlClient } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the outbox table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "outbox"), [
          "outbox.id bigint not null generated always as identity",
          "outbox.topic text not null",
          "outbox.payload jsonb not null",
          "outbox.created_at timestamp with time zone not null",
          "outbox.available_at timestamp with time zone not null",
          "outbox.locked_until timestamp with time zone",
          "outbox.attempts integer not null default 0",
          "outbox.last_error text",
          "outbox.dead_at timestamp with time zone",
        ]);
      }),
    );

    it.effect("constrains and indexes the outbox for the claim query", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "outbox"), [
          "outbox_attempts_check: CHECK ((attempts >= 0))",
          "outbox_id_pkey: PRIMARY KEY (id)",
          "outbox_topic_check: CHECK ((char_length(topic) >= 1))",
        ]);
        // Dead rows are deliberately not indexed, neither for claiming nor
        // for purging.
        assert.deepStrictEqual(yield* describeIndexes(sql, "outbox"), [
          "CREATE UNIQUE INDEX outbox_id_pkey ON public.outbox USING btree (id)",
          "CREATE INDEX outbox_topic_available_at_id_idx ON public.outbox USING btree (topic, available_at, id) WHERE (dead_at IS NULL)",
        ]);
      }),
    );

    it.effect("numbers outbox rows itself and starts with no attempts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = sql<{
          readonly id: string;
          readonly attempts: number;
          readonly lockedUntil: Date | null;
          readonly lastError: string | null;
          readonly deadAt: Date | null;
        }>`
          INSERT INTO outbox (topic, payload, created_at, available_at)
          VALUES ('outbox-defaults', '{"to":"a"}', now(), now())
          RETURNING id, attempts, locked_until, last_error, dead_at
        `;
        const [first] = yield* insert;
        const [second] = yield* insert;
        assert.strictEqual(first.attempts, 0);
        assert.strictEqual(first.lockedUntil, null);
        assert.strictEqual(first.lastError, null);
        assert.strictEqual(first.deadAt, null);
        assert.isTrue(BigInt(second.id) > BigInt(first.id));

        const exit = yield* sql`
          INSERT INTO outbox (id, topic, payload, created_at, available_at)
          VALUES (1000000, 'outbox-defaults', '{}', now(), now())
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));

        // jsonb keeps nested keys as written, whatever the topic encodes.
        const [row] = yield* sql<{ readonly payload: unknown }>`
          SELECT payload FROM outbox WHERE id = ${first.id}
        `;
        assert.deepStrictEqual(row.payload, { to: "a" });
      }),
    );

    it.effect(
      "rejects empty topics, negative attempts and missing values",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const emptyTopic = yield* sql`
          INSERT INTO outbox (topic, payload, created_at, available_at)
          VALUES ('', '{}', now(), now())
        `.pipe(Effect.flip);
          assert.strictEqual(emptyTopic.reason._tag, "ConstraintError");
          assert.propertyVal(
            emptyTopic.reason.cause,
            "constraint",
            "outbox_topic_check",
          );

          const negativeAttempts = yield* sql`
          INSERT INTO outbox (topic, payload, created_at, available_at, attempts)
          VALUES ('outbox-check', '{}', now(), now(), -1)
        `.pipe(Effect.flip);
          assert.strictEqual(negativeAttempts.reason._tag, "ConstraintError");
          assert.propertyVal(
            negativeAttempts.reason.cause,
            "constraint",
            "outbox_attempts_check",
          );

          // The application sets both timestamps: there is no default.
          for (const statement of [
            sql`
            INSERT INTO outbox (topic, payload, available_at)
            VALUES ('outbox-check', '{}', now())
          `,
            sql`
            INSERT INTO outbox (topic, payload, created_at)
            VALUES ('outbox-check', '{}', now())
          `,
            sql`
            INSERT INTO outbox (topic, created_at, available_at)
            VALUES ('outbox-check', now(), now())
          `,
          ]) {
            // Fails: a NOT NULL violation, no default fills the gap.
            yield* statement.pipe(Effect.flip);
          }
        }),
    );

    it.effect("claims only due, unlocked and living rows of the topic", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-06-01T12:00:00Z";
        const insert = (
          topic: string,
          label: string,
          availableAt: string,
          lockedUntil: string | null,
          deadAt: string | null,
        ) => sql`
          INSERT INTO outbox
            (topic, payload, created_at, available_at, locked_until, dead_at)
          VALUES (
            ${topic}, ${JSON.stringify({ label })}::jsonb, '2026-06-01T00:00:00Z',
            ${availableAt}, ${lockedUntil}, ${deadAt}
          )
        `;
        const topic = "outbox-claim";
        yield* insert(topic, "due", "2026-06-01T12:00:00Z", null, null);
        yield* insert(topic, "future", "2026-06-01T12:00:01Z", null, null);
        yield* insert(
          topic,
          "locked",
          "2026-06-01T00:00:00Z",
          "2026-06-01T12:00:00Z",
          null,
        );
        yield* insert(
          topic,
          "expired",
          "2026-06-01T00:00:00Z",
          "2026-06-01T11:59:59Z",
          null,
        );
        yield* insert(
          topic,
          "dead",
          "2026-06-01T00:00:00Z",
          null,
          "2026-06-01T11:00:00Z",
        );
        yield* insert(
          "outbox-claim-other",
          "other",
          "2026-06-01T00:00:00Z",
          null,
          null,
        );

        const claim = (limit: number) => sql<{
          readonly payload: { readonly label: string };
          readonly attempts: number;
        }>`
          UPDATE outbox SET locked_until = ${now}::timestamptz + interval '30 seconds',
            attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM outbox
            WHERE topic = ${topic} AND dead_at IS NULL
              AND available_at <= ${now}::timestamptz
              AND (locked_until IS NULL OR locked_until < ${now}::timestamptz)
            ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
          )
          RETURNING payload, attempts
        `;
        // Oldest first; the locked row's lease has not run out at `now`.
        const first = yield* claim(1);
        assert.deepStrictEqual(
          first.map((row) => row.payload.label),
          ["due"],
        );
        const rest = yield* claim(10);
        assert.deepStrictEqual(
          rest.map((row) => row.payload.label),
          ["expired"],
        );
        assert.deepStrictEqual(
          [...first, ...rest].map((row) => row.attempts),
          [1, 1],
        );
        assert.deepStrictEqual(yield* claim(10), []);
      }),
    );

    it.effect("uses the partial index to find due rows of a topic", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT id FROM outbox
              WHERE topic = 'outbox-claim' AND dead_at IS NULL
                AND available_at <= now()
                AND (locked_until IS NULL OR locked_until < now())
              ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "outbox_topic_available_at_id_idx",
        );
      }),
    );

    it.effect(
      "creates the contact_messages table with the expected columns",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepStrictEqual(
            yield* describeColumns(sql, "contact_messages"),
            [
              "contact_messages.id uuid not null",
              "contact_messages.name text not null",
              "contact_messages.email text not null",
              "contact_messages.message text not null",
              "contact_messages.created_at timestamp with time zone not null",
            ],
          );
        }),
    );

    it.effect(
      "constrains and indexes contact_messages for the retention job",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // No foreign keys: senders need no account.
          assert.deepStrictEqual(
            yield* describeConstraints(sql, "contact_messages"),
            [
              "contact_messages_email_check: CHECK (((char_length(email) >= 1) AND (char_length(email) <= 254)))",
              "contact_messages_id_pkey: PRIMARY KEY (id)",
              "contact_messages_message_check: CHECK (((char_length(message) >= 1) AND (char_length(message) <= 5000)))",
              "contact_messages_name_check: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100)))",
            ],
          );
          assert.deepStrictEqual(
            yield* describeIndexes(sql, "contact_messages"),
            [
              "CREATE INDEX contact_messages_created_at_idx ON public.contact_messages USING btree (created_at)",
              "CREATE UNIQUE INDEX contact_messages_id_pkey ON public.contact_messages USING btree (id)",
            ],
          );
        }),
    );

    it.effect(
      "accepts contact messages at the limits and counts code points",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const insert = (name: string, email: string, message: string) =>
            sql`
            INSERT INTO contact_messages (id, name, email, message, created_at)
            VALUES (gen_random_uuid(), ${name}, ${email}, ${message}, now())
          `;
          yield* insert("n", "e", "m");
          yield* insert("n".repeat(100), "e".repeat(254), "m".repeat(5000));
          // An emoji is two UTF-16 code units but one code point: the database
          // never counts more than the API does.
          yield* insert("😀".repeat(100), "e", "😀".repeat(5000));
        }),
    );
  });
});
