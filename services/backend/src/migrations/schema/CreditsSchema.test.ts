import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient, type SqlError, type Statement } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertFeatureCredit,
  insertMealPlan,
  insertPayment,
  insertPaymentProduct,
  insertUser,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

/** Fails unless `effect` fails with a violation of `constraint`. */
const expectViolation = <A, R>(
  effect: Effect.Effect<A, SqlError.SqlError, R>,
  constraint: string,
) =>
  effect.pipe(
    Effect.tap(() => Effect.sync(() => assert.fail(`accepted: ${constraint}`))),
    Effect.flip,
    Effect.map((error) => {
      if (error.reason._tag === "UniqueViolation") {
        assert.strictEqual(error.reason.constraint, constraint);
      } else {
        assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
        assert.propertyVal(error.reason.cause, "constraint", constraint);
      }
    }),
  );

/** EXPLAIN of `query` with sequential and bitmap scans turned off. */
const explain = (sql: SqlClient.SqlClient, query: Statement.Fragment) =>
  sql.withTransaction(
    Effect.gen(function* () {
      // The tables are tiny and have no statistics, so the planner would
      // prefer a sequential scan, or a bitmap scan and a sort.
      yield* sql`SET LOCAL enable_seqscan = off`;
      yield* sql`SET LOCAL enable_bitmapscan = off`;
      const plan = yield* sql<Record<string, string>>`${query}`;
      return plan.flatMap((row) => Object.values(row)).join("\n");
    }),
  );

/** A user with a paid one-off purchase. */
const buyer = (sql: SqlClient.SqlClient, subject: string) =>
  Effect.gen(function* () {
    const userId = yield* insertUser(sql, subject);
    const paymentId = yield* insertPayment(sql, { userId });
    return { userId, paymentId };
  });

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the credit tables with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeColumns(sql, "payment_product_credits"),
          [
            "payment_product_credits.product_id text not null",
            "payment_product_credits.feature text not null",
            "payment_product_credits.quantity integer not null",
            "payment_product_credits.since timestamp with time zone not null",
          ],
        );
        assert.deepStrictEqual(yield* describeColumns(sql, "feature_credits"), [
          "feature_credits.id uuid not null",
          "feature_credits.user_id uuid not null",
          "feature_credits.payment_id uuid not null",
          "feature_credits.feature text not null",
          "feature_credits.seq integer not null",
          "feature_credits.granted_at timestamp with time zone not null",
          "feature_credits.consumed_at timestamp with time zone",
          "feature_credits.used_for uuid",
          "feature_credits.revoked_at timestamp with time zone",
        ]);
      }),
    );

    it.effect("constrains and indexes the credit tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "payment_product_credits"),
          [
            "payment_product_credits_feature_check: CHECK ((feature = 'mealPlan'::text))",
            "payment_product_credits_product_id_feature_since_pkey: PRIMARY KEY (product_id, feature, since)",
            "payment_product_credits_product_id_fkey: FOREIGN KEY (product_id) REFERENCES payment_products(id) ON DELETE CASCADE",
            "payment_product_credits_quantity_check: CHECK (((quantity >= 0) AND (quantity <= 100)))",
          ],
        );
        assert.deepStrictEqual(
          yield* describeIndexes(sql, "payment_product_credits"),
          [
            "CREATE UNIQUE INDEX payment_product_credits_product_id_feature_since_pkey ON public.payment_product_credits USING btree (product_id, feature, since)",
          ],
        );
        // Plain foreign keys, like those of payments: neither users nor
        // payments are deleted as rows.
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "feature_credits"),
          [
            "feature_credits_consumed_check: CHECK (((consumed_at IS NULL) = (used_for IS NULL)))",
            "feature_credits_feature_check: CHECK ((feature = 'mealPlan'::text))",
            "feature_credits_id_pkey: PRIMARY KEY (id)",
            "feature_credits_payment_id_feature_seq_key: UNIQUE (payment_id, feature, seq)",
            "feature_credits_payment_id_fkey: FOREIGN KEY (payment_id) REFERENCES payments(id)",
            "feature_credits_seq_check: CHECK ((seq >= 1))",
            "feature_credits_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id)",
          ],
        );
        assert.deepStrictEqual(yield* describeIndexes(sql, "feature_credits"), [
          "CREATE UNIQUE INDEX feature_credits_feature_used_for_key ON public.feature_credits USING btree (feature, used_for) WHERE (used_for IS NOT NULL)",
          "CREATE UNIQUE INDEX feature_credits_id_pkey ON public.feature_credits USING btree (id)",
          "CREATE UNIQUE INDEX feature_credits_payment_id_feature_seq_key ON public.feature_credits USING btree (payment_id, feature, seq)",
          "CREATE INDEX feature_credits_user_id_feature_granted_at_available_idx ON public.feature_credits USING btree (user_id, feature, granted_at) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL))",
          "CREATE INDEX feature_credits_user_id_granted_at_idx ON public.feature_credits USING btree (user_id, granted_at DESC)",
        ]);
      }),
    );

    it.effect("keeps product credits as a version history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertPaymentProduct(sql, { id: "prod_credits" });
        const version = (
          quantity: number,
          since: string,
          feature = "mealPlan",
          productId = "prod_credits",
        ) =>
          sql`
            INSERT INTO payment_product_credits (
              product_id, feature, quantity, since
            )
            VALUES (${productId}, ${feature}, ${quantity}::integer, ${since})
          `;
        yield* version(3, "2026-01-01T00:00:00Z");
        yield* version(5, "2026-02-01T00:00:00Z");
        // 0 removes the feature from since on.
        yield* version(0, "2026-03-01T00:00:00Z");
        yield* expectViolation(
          version(4, "2026-02-01T00:00:00Z"),
          "payment_product_credits_product_id_feature_since_pkey",
        );
        for (const feature of ["mealplan", "MealPlan", "foodPlanner", ""]) {
          yield* expectViolation(
            version(1, "2026-04-01T00:00:00Z", feature),
            "payment_product_credits_feature_check",
          );
        }
        for (const quantity of [-1, 101]) {
          yield* expectViolation(
            version(quantity, "2026-04-01T00:00:00Z"),
            "payment_product_credits_quantity_check",
          );
        }
        yield* version(100, "2026-04-01T00:00:00Z");
        yield* expectViolation(
          version(1, "2026-01-01T00:00:00Z", "mealPlan", "prod_unknown"),
          "payment_product_credits_product_id_fkey",
        );
        // since is required.
        yield* sql`
          INSERT INTO payment_product_credits (product_id, feature, quantity)
          VALUES ('prod_credits', 'mealPlan', 1)
        `.pipe(Effect.flip);

        // A purchase gets the latest version at or before its checkout
        // started; none before the first version.
        const quantityAt = (at: string) =>
          sql<{ readonly quantity: number }>`
            SELECT quantity FROM payment_product_credits
            WHERE product_id = 'prod_credits' AND feature = 'mealPlan'
              AND since <= ${at}
            ORDER BY since DESC
            LIMIT 1
          `.pipe(Effect.map((rows) => rows.map((row) => row.quantity)));
        assert.deepStrictEqual(yield* quantityAt("2025-12-31T00:00:00Z"), []);
        assert.deepStrictEqual(yield* quantityAt("2026-01-01T00:00:00Z"), [3]);
        assert.deepStrictEqual(yield* quantityAt("2026-02-15T00:00:00Z"), [5]);
        assert.deepStrictEqual(yield* quantityAt("2026-03-01T00:00:00Z"), [0]);
        assert.deepStrictEqual(
          yield* quantityAt("2026-05-01T00:00:00Z"),
          [100],
        );
        const latest = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT quantity FROM payment_product_credits
            WHERE product_id = 'prod_x' AND feature = 'mealPlan'
              AND since <= '2026-02-15T00:00:00Z'
            ORDER BY since DESC
            LIMIT 1
          `,
        );
        assert.include(
          latest,
          "payment_product_credits_product_id_feature_since_pkey",
        );
        assert.notInclude(latest, "Sort");

        // The history goes with its product.
        yield* sql`DELETE FROM payment_products WHERE id = 'prod_credits'`;
        const [left] = yield* sql<{ readonly count: number }>`
          SELECT count(*)::int AS count FROM payment_product_credits
          WHERE product_id = 'prod_credits'
        `;
        assert.strictEqual(left.count, 0);
      }),
    );

    it.effect("never lets a product grant mealPlanBuyer directly", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertPaymentProduct(sql, { id: "prod_buyer_role" });
        yield* expectViolation(
          sql`
            INSERT INTO payment_product_roles (product_id, role)
            VALUES ('prod_buyer_role', 'mealPlanBuyer')
          `,
          "payment_product_roles_role_check",
        );
      }),
    );

    it.effect("accepts valid credits and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, paymentId } = yield* buyer(sql, "credits-checks");
        const credit = (
          fields: Partial<Parameters<typeof insertFeatureCredit>[1]>,
        ) => insertFeatureCredit(sql, { userId, paymentId, ...fields });

        // Available, consumed, revoked, and consumed then revoked.
        yield* credit({ seq: 1 });
        yield* credit({
          seq: 2,
          consumedAt: "2026-01-02T00:00:00Z",
          usedFor: "00000000-0000-4000-8000-0000000c0001",
        });
        yield* credit({ seq: 3, revokedAt: "2026-01-03T00:00:00Z" });
        yield* credit({
          seq: 4,
          consumedAt: "2026-01-02T00:00:00Z",
          usedFor: "00000000-0000-4000-8000-0000000c0002",
          revokedAt: "2026-01-03T00:00:00Z",
        });

        for (const feature of ["mealplan", "MealPlan", "foodPlanner", ""]) {
          yield* expectViolation(
            credit({ seq: 10, feature }),
            "feature_credits_feature_check",
          );
        }
        for (const seq of [0, -1]) {
          yield* expectViolation(credit({ seq }), "feature_credits_seq_check");
        }
        // consumed_at and used_for are set and cleared together.
        yield* expectViolation(
          credit({ seq: 10, consumedAt: "2026-01-02T00:00:00Z" }),
          "feature_credits_consumed_check",
        );
        yield* expectViolation(
          credit({ seq: 10, usedFor: "00000000-0000-4000-8000-0000000c0003" }),
          "feature_credits_consumed_check",
        );
        yield* expectViolation(
          insertFeatureCredit(sql, {
            userId: "00000000-0000-4000-8000-0000000c0004",
            paymentId,
            seq: 10,
          }),
          "feature_credits_user_id_fkey",
        );
        yield* expectViolation(
          insertFeatureCredit(sql, {
            userId,
            paymentId: "00000000-0000-4000-8000-0000000c0005",
          }),
          "feature_credits_payment_id_fkey",
        );
      }),
    );

    it.effect("grants a payment's credits once however often it syncs", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, paymentId } = yield* buyer(sql, "credits-idempotent");
        // As the webhook grants a quantity of 3, run twice.
        const grant = sql`
          INSERT INTO feature_credits (
            id, user_id, payment_id, feature, seq, granted_at
          )
          SELECT gen_random_uuid(), ${userId}, ${paymentId}, 'mealPlan', seq,
            '2026-01-01T00:00:00Z'
          FROM generate_series(1, 3) AS seq
          ON CONFLICT ON CONSTRAINT feature_credits_payment_id_feature_seq_key
            DO NOTHING
        `;
        yield* grant;
        yield* grant;
        const rows = yield* sql<{ readonly seq: number }>`
          SELECT seq FROM feature_credits
          WHERE payment_id = ${paymentId}
          ORDER BY seq
        `;
        assert.deepStrictEqual(
          rows.map((row) => row.seq),
          [1, 2, 3],
        );
        yield* expectViolation(
          insertFeatureCredit(sql, { userId, paymentId, seq: 2 }),
          "feature_credits_payment_id_feature_seq_key",
        );
        // Another payment numbers its credits from 1 again.
        const other = yield* insertPayment(sql, { userId });
        yield* insertFeatureCredit(sql, { userId, paymentId: other, seq: 1 });

        // A payment's credits are found by the key.
        const plan = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM feature_credits
            WHERE payment_id = '00000000-0000-4000-8000-0000000c0010'
          `,
        );
        assert.include(plan, "feature_credits_payment_id_feature_seq_key");
      }),
    );

    it.effect("consumes, gives back and revokes credits", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, paymentId } = yield* buyer(sql, "credits-lifecycle");
        for (const [seq, grantedAt] of [
          [1, "2026-01-02T00:00:00Z"],
          [2, "2026-01-01T00:00:00Z"],
          [3, "2026-01-03T00:00:00Z"],
        ] as const) {
          yield* insertFeatureCredit(sql, {
            userId,
            paymentId,
            seq,
            grantedAt,
          });
        }
        const planA = "00000000-0000-4000-8000-0000000c0101";
        const planB = "00000000-0000-4000-8000-0000000c0102";

        // Consuming picks the oldest available credit.
        const consume = (usedFor: string) =>
          sql<{ readonly seq: number }>`
            UPDATE feature_credits
            SET consumed_at = '2026-01-05T00:00:00Z', used_for = ${usedFor}
            WHERE id = (
              SELECT id FROM feature_credits
              WHERE user_id = ${userId} AND feature = 'mealPlan'
                AND consumed_at IS NULL AND revoked_at IS NULL
              ORDER BY granted_at
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING seq
          `;
        assert.deepStrictEqual(yield* consume(planA), [{ seq: 2 }]);
        // One credit per use.
        yield* expectViolation(
          consume(planA),
          "feature_credits_feature_used_for_key",
        );

        // A failed use gives its credit back, found by used_for.
        const released = yield* sql<{ readonly seq: number }>`
          UPDATE feature_credits SET consumed_at = NULL, used_for = NULL
          WHERE feature = 'mealPlan' AND used_for = ${planA}
          RETURNING seq
        `;
        assert.deepStrictEqual(released, [{ seq: 2 }]);
        assert.deepStrictEqual(yield* consume(planB), [{ seq: 2 }]);

        // A refund revokes the payment's credits; used ones stay used.
        yield* sql`
          UPDATE feature_credits SET revoked_at = '2026-01-06T00:00:00Z'
          WHERE payment_id = ${paymentId} AND revoked_at IS NULL
        `;
        assert.deepStrictEqual(yield* consume(planA), []);
        const credits = yield* sql<{
          readonly seq: number;
          readonly usedFor: string | null;
        }>`
          SELECT seq, used_for FROM feature_credits
          WHERE payment_id = ${paymentId}
          ORDER BY seq
        `;
        assert.deepStrictEqual(credits, [
          { seq: 1, usedFor: null },
          { seq: 2, usedFor: planB },
          { seq: 3, usedFor: null },
        ]);

        // The payment grants again (a won dispute): its credits come back.
        yield* sql`
          UPDATE feature_credits SET revoked_at = NULL
          WHERE payment_id = ${paymentId}
        `;
        const [available] = yield* sql<{ readonly count: number }>`
          SELECT count(*)::int AS count FROM feature_credits
          WHERE user_id = ${userId} AND feature = 'mealPlan'
            AND consumed_at IS NULL AND revoked_at IS NULL
        `;
        assert.strictEqual(available.count, 2);

        // A payment with credits can't be deleted.
        yield* expectViolation(
          sql`DELETE FROM payments WHERE id = ${paymentId}`,
          "feature_credits_payment_id_fkey",
        );
      }),
    );

    it.effect("finds a user's credits with the user indexes", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const pick = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM feature_credits
            WHERE user_id = '00000000-0000-4000-8000-0000000c0201'
              AND feature = 'mealPlan'
              AND consumed_at IS NULL AND revoked_at IS NULL
            ORDER BY granted_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `,
        );
        assert.include(
          pick,
          "feature_credits_user_id_feature_granted_at_available_idx",
        );
        assert.notInclude(pick, "Sort");
        const listing = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM feature_credits
            WHERE user_id = '00000000-0000-4000-8000-0000000c0201'
            ORDER BY granted_at DESC
          `,
        );
        assert.include(listing, "feature_credits_user_id_granted_at_idx");
        assert.notInclude(listing, "Sort");
      }),
    );

    it.effect("marks when a meal plan started being written", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "credits-started-at");
        const planId = yield* insertMealPlan(sql, { userId });
        const startedAt = () =>
          sql<{ readonly startedAt: Date | null }>`
            SELECT started_at FROM meal_plans WHERE id = ${planId}
          `.pipe(Effect.map(([row]) => row.startedAt));
        // Not started until the job sets it.
        assert.isNull(yield* startedAt());
        yield* sql`
          UPDATE meal_plans SET started_at = '2026-01-01T00:00:10Z'
          WHERE id = ${planId} AND started_at IS NULL
        `;
        const started = yield* startedAt();
        assert.strictEqual(
          started === null ? null : new Date(started).toISOString(),
          "2026-01-01T00:00:10.000Z",
        );
        // Finishing the plan keeps it.
        yield* sql`
          UPDATE meal_plans
          SET status = 'failed', failure_reason = 'plannerFailed',
            finished_at = '2026-01-01T00:01:00Z'
          WHERE id = ${planId}
        `;
        assert.isNotNull(yield* startedAt());
      }),
    );

    it.effect("accepts the credits audit action and the earlier ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (action: string) =>
          sql`
            INSERT INTO audit_log (at, action)
            VALUES ('2026-01-01T00:00:00Z', ${action})
          `;
        for (const action of [
          "payment_product_credits_changed",
          // Still allowed.
          "payment_product_roles_changed",
          "login",
        ]) {
          yield* insert(action);
        }
        yield* expectViolation(
          insert("payment_credits_changed"),
          "audit_log_action_check",
        );
      }),
    );
  });
});
