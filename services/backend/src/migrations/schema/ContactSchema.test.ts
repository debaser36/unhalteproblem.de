import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("rejects empty and too long contact message values", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (name: string, email: string, message: string) =>
          sql`
            INSERT INTO contact_messages (id, name, email, message, created_at)
            VALUES (gen_random_uuid(), ${name}, ${email}, ${message}, now())
          `.pipe(Effect.flip);
        const cases = [
          ["", "e", "m", "contact_messages_name_check"],
          ["n".repeat(101), "e", "m", "contact_messages_name_check"],
          ["n", "", "m", "contact_messages_email_check"],
          ["n", "e".repeat(255), "m", "contact_messages_email_check"],
          ["n", "e", "", "contact_messages_message_check"],
          ["n", "e", "m".repeat(5001), "contact_messages_message_check"],
        ] as const;
        for (const [name, email, message, constraint] of cases) {
          const error = yield* insert(name, email, message);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // The application sets id and created_at: there is no default.
        for (const statement of [
          sql`
            INSERT INTO contact_messages (name, email, message, created_at)
            VALUES ('n', 'e', 'm', now())
          `,
          sql`
            INSERT INTO contact_messages (id, name, email, message)
            VALUES (gen_random_uuid(), 'n', 'e', 'm')
          `,
        ]) {
          // Fails: a NOT NULL violation, no default fills the gap.
          yield* statement.pipe(Effect.flip);
        }
      }),
    );

    it.effect("uses the created_at index to find old contact messages", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              DELETE FROM contact_messages
              WHERE created_at < '2026-01-01T00:00:00Z'::timestamptz
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "contact_messages_created_at_idx",
        );
      }),
    );

    it.effect("purges only contact messages older than the cutoff", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO contact_messages (id, name, email, message, created_at)
          VALUES
            (gen_random_uuid(), 'purge', 'e', 'old', '2025-12-31T23:59:59Z'),
            (gen_random_uuid(), 'purge', 'e', 'new', '2026-01-01T00:00:00Z')
        `;
        yield* sql`
          DELETE FROM contact_messages
          WHERE created_at < ${"2026-01-01T00:00:00Z"}::timestamptz
        `;
        const rows = yield* sql<{ readonly message: string }>`
          SELECT message FROM contact_messages WHERE name = 'purge'
        `;
        assert.deepStrictEqual(
          rows.map((row) => row.message),
          ["new"],
        );
      }),
    );
  });
});
