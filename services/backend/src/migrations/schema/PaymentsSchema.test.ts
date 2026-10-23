import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertPayment,
  insertPaymentPrice,
  insertPaymentProduct,
  insertPaymentSubscription,
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

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the payment tables with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeColumns(sql, "stripe_customers"),
          [
            "stripe_customers.user_id uuid not null",
            "stripe_customers.livemode boolean not null",
            "stripe_customers.customer_id text not null",
            "stripe_customers.created_at timestamp with time zone not null",
          ],
        );
        assert.deepStrictEqual(
          yield* describeColumns(sql, "payment_products"),
          [
            "payment_products.id text not null",
            "payment_products.name text not null",
            "payment_products.description text",
            "payment_products.active boolean not null",
            "payment_products.livemode boolean not null",
            "payment_products.enabled boolean not null default false",
            "payment_products.kind text not null default 'standard'::text",
            "payment_products.updated_at timestamp with time zone not null",
          ],
        );
        assert.deepStrictEqual(
          yield* describeColumns(sql, "payment_product_roles"),
          [
            "payment_product_roles.product_id text not null",
            "payment_product_roles.role text not null",
          ],
        );
        assert.deepStrictEqual(yield* describeColumns(sql, "payment_prices"), [
          "payment_prices.id text not null",
          "payment_prices.product_id text not null",
          "payment_prices.active boolean not null",
          "payment_prices.currency text not null",
          "payment_prices.unit_amount integer",
          "payment_prices.recurring_interval text",
          "payment_prices.recurring_interval_count integer",
          "payment_prices.livemode boolean not null",
          "payment_prices.updated_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(
          yield* describeColumns(sql, "payment_subscriptions"),
          [
            "payment_subscriptions.id text not null",
            "payment_subscriptions.user_id uuid",
            "payment_subscriptions.customer_id text not null",
            "payment_subscriptions.product_id text",
            "payment_subscriptions.price_id text",
            "payment_subscriptions.status text not null",
            "payment_subscriptions.current_period_end timestamp with time zone",
            "payment_subscriptions.cancel_at_period_end boolean not null",
            "payment_subscriptions.canceled_at timestamp with time zone",
            "payment_subscriptions.livemode boolean not null",
            "payment_subscriptions.created_at timestamp with time zone not null",
            "payment_subscriptions.updated_at timestamp with time zone not null",
          ],
        );
        assert.deepStrictEqual(yield* describeColumns(sql, "payments"), [
          "payments.id uuid not null",
          "payments.user_id uuid",
          "payments.kind text not null",
          "payments.product_id text",
          "payments.checkout_session_id text",
          "payments.invoice_id text",
          "payments.subscription_id text",
          "payments.payment_intent_id text",
          "payments.amount integer not null",
          "payments.amount_refunded integer not null default 0",
          "payments.currency text not null",
          "payments.status text not null",
          "payments.livemode boolean not null",
          "payments.created_at timestamp with time zone not null",
          "payments.updated_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "stripe_events"), [
          "stripe_events.id text not null",
          "stripe_events.type text not null",
          "stripe_events.livemode boolean not null",
          "stripe_events.received_at timestamp with time zone not null",
        ]);
      }),
    );

    it.effect("constrains and indexes the payment tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "stripe_customers"),
          [
            "stripe_customers_customer_id_key: UNIQUE (customer_id)",
            "stripe_customers_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id)",
            "stripe_customers_user_id_livemode_pkey: PRIMARY KEY (user_id, livemode)",
          ],
        );
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "payment_products"),
          [
            "payment_products_id_pkey: PRIMARY KEY (id)",
            "payment_products_kind_check: CHECK ((kind = ANY (ARRAY['standard'::text, 'tip'::text])))",
          ],
        );
        assert.deepStrictEqual(
          yield* describeIndexes(sql, "payment_products"),
          [
            "CREATE UNIQUE INDEX payment_products_id_pkey ON public.payment_products USING btree (id)",
            "CREATE UNIQUE INDEX payment_products_livemode_tip_key ON public.payment_products USING btree (livemode) WHERE (kind = 'tip'::text)",
          ],
        );
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "payment_product_roles"),
          [
            "payment_product_roles_product_id_fkey: FOREIGN KEY (product_id) REFERENCES payment_products(id) ON DELETE CASCADE",
            "payment_product_roles_product_id_role_pkey: PRIMARY KEY (product_id, role)",
            "payment_product_roles_role_check: CHECK ((role = 'foodPlanner'::text))",
          ],
        );
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "payment_prices"),
          [
            "payment_prices_currency_check: CHECK ((currency ~ '^[a-z]{3}$'::text))",
            "payment_prices_id_pkey: PRIMARY KEY (id)",
            "payment_prices_product_id_fkey: FOREIGN KEY (product_id) REFERENCES payment_products(id)",
            "payment_prices_recurring_check: CHECK (((recurring_interval IS NULL) = (recurring_interval_count IS NULL)))",
            "payment_prices_recurring_interval_check: CHECK ((recurring_interval = ANY (ARRAY['day'::text, 'week'::text, 'month'::text, 'year'::text])))",
            "payment_prices_recurring_interval_count_check: CHECK ((recurring_interval_count > 0))",
            "payment_prices_unit_amount_check: CHECK ((unit_amount >= 0))",
          ],
        );
        assert.deepStrictEqual(yield* describeIndexes(sql, "payment_prices"), [
          "CREATE UNIQUE INDEX payment_prices_id_pkey ON public.payment_prices USING btree (id)",
          "CREATE INDEX payment_prices_product_id_idx ON public.payment_prices USING btree (product_id)",
        ]);
        // No foreign keys to products or prices: webhooks can arrive before
        // the product is mirrored.
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "payment_subscriptions"),
          [
            "payment_subscriptions_id_pkey: PRIMARY KEY (id)",
            "payment_subscriptions_status_check: CHECK ((status = ANY (ARRAY['incomplete'::text, 'incompleteExpired'::text, 'trialing'::text, 'active'::text, 'pastDue'::text, 'canceled'::text, 'unpaid'::text, 'paused'::text])))",
            "payment_subscriptions_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id)",
          ],
        );
        assert.deepStrictEqual(
          yield* describeIndexes(sql, "payment_subscriptions"),
          [
            "CREATE INDEX payment_subscriptions_created_at_id_idx ON public.payment_subscriptions USING btree (created_at DESC, id)",
            "CREATE UNIQUE INDEX payment_subscriptions_id_pkey ON public.payment_subscriptions USING btree (id)",
            "CREATE INDEX payment_subscriptions_product_id_active_idx ON public.payment_subscriptions USING btree (product_id) WHERE (status = ANY (ARRAY['active'::text, 'trialing'::text]))",
            "CREATE INDEX payment_subscriptions_user_id_idx ON public.payment_subscriptions USING btree (user_id)",
          ],
        );
        assert.deepStrictEqual(yield* describeConstraints(sql, "payments"), [
          "payments_amount_check: CHECK ((amount >= 0))",
          "payments_amount_refunded_check: CHECK (((amount_refunded >= 0) AND (amount_refunded <= amount)))",
          "payments_checkout_session_id_key: UNIQUE (checkout_session_id)",
          "payments_currency_check: CHECK ((currency ~ '^[a-z]{3}$'::text))",
          "payments_id_pkey: PRIMARY KEY (id)",
          "payments_invoice_id_key: UNIQUE (invoice_id)",
          "payments_kind_check: CHECK ((kind = ANY (ARRAY['purchase'::text, 'tip'::text, 'subscription'::text])))",
          "payments_kind_invoice_id_check: CHECK (((kind = 'subscription'::text) = (invoice_id IS NOT NULL)))",
          "payments_payment_intent_id_key: UNIQUE (payment_intent_id)",
          "payments_reference_check: CHECK (((checkout_session_id IS NOT NULL) OR (invoice_id IS NOT NULL)))",
          "payments_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partiallyRefunded'::text, 'disputed'::text, 'disputeLost'::text])))",
          "payments_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id)",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "payments"), [
          "CREATE UNIQUE INDEX payments_checkout_session_id_key ON public.payments USING btree (checkout_session_id)",
          "CREATE INDEX payments_created_at_id_idx ON public.payments USING btree (created_at DESC, id)",
          "CREATE UNIQUE INDEX payments_id_pkey ON public.payments USING btree (id)",
          "CREATE UNIQUE INDEX payments_invoice_id_key ON public.payments USING btree (invoice_id)",
          "CREATE UNIQUE INDEX payments_payment_intent_id_key ON public.payments USING btree (payment_intent_id)",
          "CREATE INDEX payments_user_id_created_at_idx ON public.payments USING btree (user_id, created_at DESC)",
        ]);
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "stripe_events"),
          ["stripe_events_id_pkey: PRIMARY KEY (id)"],
        );
      }),
    );

    it.effect("defaults user_roles.manual to true for new roles", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const user = yield* insertUser(sql, "payments-manual");
        // As the registration and the admin API insert roles, without the
        // column.
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES (${user}, 'normalUser')
        `;
        // As a payment grants one.
        yield* sql`
          INSERT INTO user_roles (user_id, role, manual)
          VALUES (${user}, 'foodPlanner', false)
        `;
        const roles = yield* sql<{
          readonly role: string;
          readonly manual: boolean;
        }>`
          SELECT role, manual FROM user_roles
          WHERE user_id = ${user}
          ORDER BY role
        `;
        assert.deepStrictEqual(roles, [
          { role: "foodPlanner", manual: false },
          { role: "normalUser", manual: true },
        ]);
        // NOT NULL.
        yield* sql`
          INSERT INTO user_roles (user_id, role, manual)
          VALUES (${user}, 'admin', NULL)
        `.pipe(Effect.flip);
      }),
    );

    it.effect("lets products grant foodPlanner and no other role", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertPaymentProduct(sql, { id: "prod_roles" });
        const grant = (role: string) =>
          sql`
            INSERT INTO payment_product_roles (product_id, role)
            VALUES ('prod_roles', ${role})
          `;
        yield* grant("foodPlanner");
        for (const role of [
          "admin",
          "superAdmin",
          "normalUser",
          "blogEditor:rust-notes",
          "foodplanner",
          "",
        ]) {
          yield* expectViolation(
            grant(role),
            "payment_product_roles_role_check",
          );
        }
        yield* expectViolation(
          grant("foodPlanner"),
          "payment_product_roles_product_id_role_pkey",
        );
        yield* expectViolation(
          sql`
            INSERT INTO payment_product_roles (product_id, role)
            VALUES ('prod_unknown', 'foodPlanner')
          `,
          "payment_product_roles_product_id_fkey",
        );

        // The roles go with their product.
        yield* sql`DELETE FROM payment_products WHERE id = 'prod_roles'`;
        const [left] = yield* sql<{ readonly count: number }>`
          SELECT count(*)::int AS count FROM payment_product_roles
          WHERE product_id = 'prod_roles'
        `;
        assert.strictEqual(left.count, 0);
      }),
    );

    it.effect("allows one tip product per mode", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertPaymentProduct(sql, { id: "prod_tip_test", kind: "tip" });
        yield* insertPaymentProduct(sql, {
          id: "prod_tip_live",
          kind: "tip",
          livemode: true,
        });
        // Standard products are not limited.
        yield* insertPaymentProduct(sql, { id: "prod_standard_1" });
        yield* insertPaymentProduct(sql, { id: "prod_standard_2" });

        yield* expectViolation(
          insertPaymentProduct(sql, { id: "prod_tip_test_2", kind: "tip" }),
          "payment_products_livemode_tip_key",
        );
        yield* expectViolation(
          sql`
            UPDATE payment_products SET kind = 'tip'
            WHERE id = 'prod_standard_1'
          `,
          "payment_products_livemode_tip_key",
        );
        yield* expectViolation(
          insertPaymentProduct(sql, { id: "prod_other", kind: "donation" }),
          "payment_products_kind_check",
        );

        // Once the tip product is a standard one, another can be the tip.
        yield* sql`
          UPDATE payment_products SET kind = 'standard'
          WHERE id = 'prod_tip_test'
        `;
        yield* sql`
          UPDATE payment_products SET kind = 'tip'
          WHERE id = 'prod_standard_1'
        `;

        const [defaults] = yield* sql<{
          readonly enabled: boolean;
          readonly kind: string;
        }>`
          SELECT enabled, kind FROM payment_products
          WHERE id = 'prod_standard_2'
        `;
        assert.deepStrictEqual(defaults, { enabled: false, kind: "standard" });
      }),
    );

    it.effect("pairs a price's recurring interval with its count", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertPaymentProduct(sql, { id: "prod_prices" });
        // One-time, recurring, and without a fixed amount.
        yield* insertPaymentPrice(sql, {
          id: "price_once",
          productId: "prod_prices",
        });
        for (const interval of ["day", "week", "month", "year"]) {
          yield* insertPaymentPrice(sql, {
            id: `price_${interval}`,
            productId: "prod_prices",
            recurringInterval: interval,
            recurringIntervalCount: 1,
          });
        }
        yield* insertPaymentPrice(sql, {
          id: "price_custom",
          productId: "prod_prices",
          unitAmount: null,
        });

        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_interval_only",
            productId: "prod_prices",
            recurringInterval: "month",
          }),
          "payment_prices_recurring_check",
        );
        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_count_only",
            productId: "prod_prices",
            recurringIntervalCount: 3,
          }),
          "payment_prices_recurring_check",
        );
        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_zero_count",
            productId: "prod_prices",
            recurringInterval: "month",
            recurringIntervalCount: 0,
          }),
          "payment_prices_recurring_interval_count_check",
        );
        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_hourly",
            productId: "prod_prices",
            recurringInterval: "hour",
            recurringIntervalCount: 1,
          }),
          "payment_prices_recurring_interval_check",
        );
        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_negative",
            productId: "prod_prices",
            unitAmount: -1,
          }),
          "payment_prices_unit_amount_check",
        );
        for (const currency of ["EUR", "eu", "euro", ""]) {
          yield* expectViolation(
            insertPaymentPrice(sql, {
              id: `price_currency_${currency}`,
              productId: "prod_prices",
              currency,
            }),
            "payment_prices_currency_check",
          );
        }
        yield* expectViolation(
          insertPaymentPrice(sql, {
            id: "price_orphan",
            productId: "prod_unknown",
          }),
          "payment_prices_product_id_fkey",
        );
      }),
    );

    it.effect(
      "accepts the subscription statuses as the contract spells them",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const statuses = [
            "incomplete",
            "incompleteExpired",
            "trialing",
            "active",
            "pastDue",
            "canceled",
            "unpaid",
            "paused",
          ];
          for (const status of statuses) {
            // product_id needs no mirrored product.
            yield* insertPaymentSubscription(sql, {
              id: `sub_${status}`,
              productId: "prod_not_mirrored",
              status,
            });
          }
          for (const status of ["past_due", "incomplete_expired", "Active"]) {
            yield* expectViolation(
              insertPaymentSubscription(sql, { id: `sub_${status}`, status }),
              "payment_subscriptions_status_check",
            );
          }
        }),
    );

    it.effect("checks payment amounts, kinds and Stripe references", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const buyer = yield* insertUser(sql, "payments-buyer");

        // A purchase and a tip come from a Checkout session, a subscription
        // payment from an invoice. product_id needs no mirrored product.
        yield* insertPayment(sql, {
          userId: buyer,
          productId: "prod_not_mirrored",
        });
        yield* insertPayment(sql, { kind: "tip" });
        yield* insertPayment(sql, {
          kind: "subscription",
          checkoutSessionId: null,
          invoiceId: "in_1",
          subscriptionId: "sub_1",
        });
        // The first invoice of a subscription started through Checkout.
        yield* insertPayment(sql, {
          kind: "subscription",
          checkoutSessionId: "cs_with_invoice",
          invoiceId: "in_2",
        });

        // Refunds up to the whole amount.
        yield* insertPayment(sql, { amount: 0 });
        yield* insertPayment(sql, { amount: 500, amountRefunded: 500 });
        yield* insertPayment(sql, { amount: 500, amountRefunded: 1 });
        yield* expectViolation(
          insertPayment(sql, { amount: 500, amountRefunded: 501 }),
          "payments_amount_refunded_check",
        );
        yield* expectViolation(
          insertPayment(sql, { amountRefunded: -1 }),
          "payments_amount_refunded_check",
        );
        yield* expectViolation(
          insertPayment(sql, { amount: -1 }),
          "payments_amount_check",
        );

        // Exactly the subscription payments have an invoice.
        yield* expectViolation(
          insertPayment(sql, { kind: "subscription" }),
          "payments_kind_invoice_id_check",
        );
        yield* expectViolation(
          insertPayment(sql, { kind: "purchase", invoiceId: "in_3" }),
          "payments_kind_invoice_id_check",
        );
        // Neither a Checkout session nor an invoice.
        yield* expectViolation(
          insertPayment(sql, { checkoutSessionId: null }),
          "payments_reference_check",
        );

        // Each Stripe object is one payment.
        yield* insertPayment(sql, {
          checkoutSessionId: "cs_unique",
          paymentIntentId: "pi_unique",
        });
        yield* expectViolation(
          insertPayment(sql, { checkoutSessionId: "cs_unique" }),
          "payments_checkout_session_id_key",
        );
        yield* expectViolation(
          insertPayment(sql, { paymentIntentId: "pi_unique" }),
          "payments_payment_intent_id_key",
        );
        yield* expectViolation(
          insertPayment(sql, {
            kind: "subscription",
            checkoutSessionId: null,
            invoiceId: "in_1",
          }),
          "payments_invoice_id_key",
        );

        for (const status of [
          "pending",
          "paid",
          "failed",
          "refunded",
          "partiallyRefunded",
          "disputed",
          "disputeLost",
        ]) {
          yield* insertPayment(sql, { status });
        }
        for (const status of ["partially_refunded", "succeeded"]) {
          yield* expectViolation(
            insertPayment(sql, { status }),
            "payments_status_check",
          );
        }
        yield* expectViolation(
          insertPayment(sql, { kind: "donation" }),
          "payments_kind_check",
        );
        yield* expectViolation(
          insertPayment(sql, { currency: "EUR" }),
          "payments_currency_check",
        );

        // Payment records are kept: a user who paid can't be deleted as a
        // row (accounts are tombstoned instead).
        yield* expectViolation(
          sql`DELETE FROM users WHERE id = ${buyer}`,
          "payments_user_id_fkey",
        );
      }),
    );

    it.effect("keeps one Stripe customer per user and mode", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const user = yield* insertUser(sql, "payments-customer");
        const other = yield* insertUser(sql, "payments-customer-other");
        const insert = (userId: string, livemode: boolean, customer: string) =>
          sql`
            INSERT INTO stripe_customers (user_id, livemode, customer_id, created_at)
            VALUES (${userId}, ${livemode}, ${customer}, now())
          `;
        yield* insert(user, false, "cus_test");
        yield* insert(user, true, "cus_live");
        yield* expectViolation(
          insert(user, false, "cus_test_2"),
          "stripe_customers_user_id_livemode_pkey",
        );
        yield* expectViolation(
          insert(other, false, "cus_test"),
          "stripe_customers_customer_id_key",
        );
      }),
    );

    it.effect("deduplicates webhook events by id", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = sql`
          INSERT INTO stripe_events (id, type, livemode, received_at)
          VALUES ('evt_1', 'invoice.paid', false, now())
        `;
        yield* insert;
        yield* expectViolation(insert, "stripe_events_id_pkey");
      }),
    );

    it.effect("accepts the payment audit actions and the earlier ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (action: string) =>
          sql`
            INSERT INTO audit_log (at, action)
            VALUES ('2026-01-01T00:00:00Z', ${action})
          `;
        for (const action of [
          "payment_refunded",
          "payment_product_updated",
          "payment_product_roles_changed",
          "payment_catalog_synced",
          // Still allowed.
          "login",
          "category_deleted",
        ]) {
          yield* insert(action);
        }
        yield* expectViolation(
          insert("payment_created"),
          "audit_log_action_check",
        );
      }),
    );
  });
});
