import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { AuditAction } from "#domains/audit/Audit";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the audit_log table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // at has no default: the application sets it from the Effect clock.
        assert.deepStrictEqual(yield* describeColumns(sql, "audit_log"), [
          "audit_log.id bigint not null generated always as identity",
          "audit_log.at timestamp with time zone not null",
          "audit_log.action text not null",
          "audit_log.actor_id uuid",
          "audit_log.target_id uuid",
          "audit_log.detail text",
        ]);
      }),
    );

    it.effect("constrains and indexes audit_log for purge and history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // No foreign keys: the log outlives users and never blocks deleting
        // one.
        assert.deepStrictEqual(yield* describeConstraints(sql, "audit_log"), [
          "audit_log_action_check: CHECK ((action = ANY (ARRAY['login'::text, 'logout'::text, 'login_refused'::text, 'role_granted'::text, 'role_revoked'::text, 'user_restricted'::text, 'restriction_lifted'::text, 'account_deleted'::text, 'outbox_retried'::text, 'contact_message_deleted'::text, 'blog_created'::text, 'blog_updated'::text, 'post_deleted'::text, 'project_created'::text, 'project_updated'::text, 'project_deleted'::text, 'blog_request_approved'::text, 'blog_request_rejected'::text, 'category_created'::text, 'category_renamed'::text, 'category_merged'::text, 'category_deleted'::text, 'payment_refunded'::text, 'payment_product_updated'::text, 'payment_product_roles_changed'::text, 'payment_catalog_synced'::text])))",
          "audit_log_detail_check: CHECK (((char_length(detail) >= 1) AND (char_length(detail) <= 100)))",
          "audit_log_id_pkey: PRIMARY KEY (id)",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "audit_log"), [
          "CREATE INDEX audit_log_action_id_idx ON public.audit_log USING btree (action, id)",
          "CREATE INDEX audit_log_actor_id_idx ON public.audit_log USING btree (actor_id, id) WHERE (actor_id IS NOT NULL)",
          "CREATE INDEX audit_log_at_idx ON public.audit_log USING btree (at)",
          "CREATE UNIQUE INDEX audit_log_id_pkey ON public.audit_log USING btree (id)",
          "CREATE INDEX audit_log_target_id_idx ON public.audit_log USING btree (target_id, id) WHERE (target_id IS NOT NULL)",
        ]);
      }),
    );

    it.effect("accepts the known actions and rejects any other", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (action: string) =>
          sql`
            INSERT INTO audit_log (at, action)
            VALUES ('2026-01-01T00:00:00Z', ${action})
          `;
        // Every action the application writes, so the schema and the check
        // cannot drift apart.
        for (const action of AuditAction.literals) {
          yield* insert(action);
        }
        for (const action of ["", "Login", "password_changed"]) {
          const error = yield* insert(action).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "audit_log_action_check",
          );
        }
      }),
    );

    it.effect("limits details to 1 to 100 characters or NULL", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (detail: string | null) =>
          sql`
            INSERT INTO audit_log (at, action, detail)
            VALUES ('2026-01-01T00:00:00Z', 'role_granted', ${detail})
          `;
        yield* insert(null);
        yield* insert("a");
        yield* insert("a".repeat(100));
        yield* insert("😀".repeat(100));
        for (const detail of ["", "a".repeat(101)]) {
          const error = yield* insert(detail).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "audit_log_detail_check",
          );
        }
      }),
    );

    it.effect("numbers audit_log rows itself and requires at", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // ALWAYS identity: an insert cannot choose the id.
        yield* sql`
          INSERT INTO audit_log (id, at, action)
          VALUES (1000, '2026-01-01T00:00:00Z', 'login')
        `.pipe(Effect.flip);
        // The application sets at: there is no default.
        yield* sql`INSERT INTO audit_log (action) VALUES ('login')`.pipe(
          Effect.flip,
        );

        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'login'), ('2026-01-01T00:00:00Z', 'logout')
        `;
        const ids = yield* sql<{ readonly id: string | number }>`
          SELECT id FROM audit_log ORDER BY id DESC LIMIT 2
        `;
        assert.strictEqual(Number(ids[0]!.id), Number(ids[1]!.id) + 1);
      }),
    );

    it.effect(
      "keeps the audit_log when the users it mentions are deleted",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // Ids of users that never existed are fine: there are no foreign
          // keys, so the log never blocks deleting a user.
          yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES (
            '2026-01-01T00:00:00Z', 'role_granted',
            gen_random_uuid(), gen_random_uuid(), 'admin'
          )
        `;
          const references = yield* sql<{ readonly count: string | number }>`
          SELECT count(*) AS count FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass AND contype = 'f'
        `;
          assert.strictEqual(Number(references[0]!.count), 0);
        }),
    );

    it.effect("uses the at index to purge old audit_log rows", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              DELETE FROM audit_log
              WHERE at < '2026-01-01T00:00:00Z'::timestamptz
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "audit_log_at_idx",
        );
      }),
    );

    it.effect("uses the target_id index to page one user's history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT * FROM audit_log
              WHERE target_id = ${"00000000-0000-4000-8000-000000000000"}::uuid
                AND id > ${0}
              ORDER BY id
              LIMIT 10
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "audit_log_target_id_idx");
        // The index delivers the order: no separate sort step.
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("uses the actor and target indexes for a user's history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan
        // or a walk along the primary key.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            yield* sql`SET LOCAL enable_indexscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT * FROM audit_log
              WHERE (
                  actor_id = ${"00000000-0000-4000-8000-000000000000"}::uuid
                  OR target_id = ${"00000000-0000-4000-8000-000000000000"}::uuid
                )
                AND id < ${1000}
              ORDER BY id DESC
              LIMIT 10
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "audit_log_actor_id_idx");
        assert.include(text, "audit_log_target_id_idx");
      }),
    );

    it.effect("uses the action index to page one action newest first", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT * FROM audit_log
              WHERE action = ${"account_deleted"} AND id < ${1000}
              ORDER BY id DESC
              LIMIT 10
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(
          text,
          "Index Scan Backward using audit_log_action_id_idx",
        );
        // The index delivers the order: no separate sort step.
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("pages a user's history and one action newest first", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const admin = "00000000-0000-4000-8000-0000000000b1";
        const user = "00000000-0000-4000-8000-0000000000b2";
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2026-02-01T00:00:00Z', 'login', ${admin}, ${admin}, NULL),
            ('2026-02-01T00:01:00Z', 'role_granted', ${admin}, ${user}, 'admin'),
            ('2026-02-01T00:02:00Z', 'outbox_retried', ${admin}, NULL, 'paging-topic'),
            ('2026-02-01T00:03:00Z', 'login', ${user}, ${user}, NULL),
            ('2026-02-01T00:04:00Z', 'contact_message_deleted', ${admin}, NULL, NULL),
            ('2026-02-01T00:05:00Z', 'outbox_retried', NULL, NULL, 'paging-topic')
        `;
        const maxId = 2 ** 62;

        const byUser = (beforeId: number) =>
          sql<{ readonly id: string | number; readonly action: string }>`
            SELECT id, action FROM audit_log
            WHERE (actor_id = ${admin}::uuid OR target_id = ${admin}::uuid)
              AND id < ${beforeId}
            ORDER BY id DESC
            LIMIT 2
          `;
        const first = yield* byUser(maxId);
        assert.deepStrictEqual(
          first.map((row) => row.action),
          ["contact_message_deleted", "outbox_retried"],
        );
        // The login is both acted and suffered by the admin, yet listed once.
        const second = yield* byUser(Number(first[1]!.id));
        assert.deepStrictEqual(
          second.map((row) => row.action),
          ["role_granted", "login"],
        );
        assert.deepStrictEqual(yield* byUser(Number(second[1]!.id)), []);

        const byAction = (beforeId: number) =>
          sql<{
            readonly id: string | number;
            readonly actorId: string | null;
          }>`
            SELECT id, actor_id FROM audit_log
            WHERE action = 'outbox_retried' AND detail = 'paging-topic'
              AND id < ${beforeId}
            ORDER BY id DESC
            LIMIT 1
          `;
        const newest = yield* byAction(maxId);
        assert.deepStrictEqual(
          newest.map((row) => row.actorId),
          [null],
        );
        const older = yield* byAction(Number(newest[0]!.id));
        assert.deepStrictEqual(
          older.map((row) => row.actorId),
          [admin],
        );
      }),
    );

    it.effect("pages one user's history by id and purges by time", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const user = "00000000-0000-4000-8000-0000000000a1";
        const other = "00000000-0000-4000-8000-0000000000a2";
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2025-12-31T23:59:59Z', 'login', ${user}, ${user}, NULL),
            ('2026-01-01T00:00:00Z', 'login', ${other}, ${other}, NULL),
            ('2026-01-02T00:00:00Z', 'role_granted', NULL, ${user}, 'admin'),
            ('2026-01-03T00:00:00Z', 'logout', ${user}, ${user}, NULL)
        `;
        const page = (afterId: number) =>
          sql<{ readonly id: string | number; readonly action: string }>`
            SELECT id, action FROM audit_log
            WHERE target_id = ${user}::uuid AND id > ${afterId}
            ORDER BY id
            LIMIT 2
          `;
        const first = yield* page(0);
        assert.deepStrictEqual(
          first.map((row) => row.action),
          ["login", "role_granted"],
        );
        const second = yield* page(Number(first[1]!.id));
        assert.deepStrictEqual(
          second.map((row) => row.action),
          ["logout"],
        );

        yield* sql`
          DELETE FROM audit_log
          WHERE at < ${"2026-01-01T00:00:00Z"}::timestamptz
            AND target_id = ${user}::uuid
        `;
        const rest = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log WHERE target_id = ${user}::uuid
          ORDER BY id
        `;
        assert.deepStrictEqual(
          rest.map((row) => row.action),
          ["role_granted", "logout"],
        );
      }),
    );
  });
});
