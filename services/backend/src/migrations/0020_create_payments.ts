import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Payments through Stripe: customers, the product catalog mirrored from
 * Stripe, subscriptions, payments, the deduplication of webhook deliveries,
 * roles held because of a payment, and the audit actions of managing
 * payments.
 *
 * Products and prices are created in the Stripe dashboard and mirrored into
 * payment_products and payment_prices by webhooks (or a manual sync).
 * Subscriptions and payments are written from webhooks as well. Stripe ids
 * (`cus_…`, `prod_…`, `price_…`, `sub_…`, `in_…`, `cs_…`, `pi_…`, `evt_…`)
 * are stored as Stripe sends them, as text. Every table that mirrors Stripe
 * has livemode, so test-mode and live-mode objects never mix.
 *
 * Amounts are integers in the minor unit of their currency (cents), and
 * currencies lowercase ISO 4217 codes (`eur`), both as Stripe has them and
 * as the contract's `Money` encodes them. Statuses and kinds are stored
 * exactly as the contract spells them (camelCase: `pastDue`,
 * `partiallyRefunded`), not as Stripe does (`past_due`); the application
 * maps them.
 *
 * Subscriptions and payments have no foreign keys to products or prices: a
 * webhook about a payment can arrive before the one that mirrors its
 * product. Their user foreign keys are plain (no CASCADE or SET NULL):
 * accounts are deleted as tombstones (0010), never as rows, and payment
 * records are kept for accounting, so the database refuses to delete a user
 * who paid. user_id is NULL when a payment or subscription can't be matched
 * to one of our users (for example one created in the Stripe dashboard).
 *
 * Paid access grants roles. user_roles.manual tells a role held because
 * someone granted it (a superAdmin, the registration, an operator: true)
 * from one held only because of a payment (false), so that an entitlement
 * that ends revokes only the roles it granted:
 *
 * - a payment grant inserts manual = false, and does nothing if the role is
 *   held already;
 * - a superAdmin grant of a role held because of a payment sets manual =
 *   true;
 * - revoking because an entitlement ended deletes only rows with manual =
 *   false;
 * - a superAdmin revoke deletes the row whatever manual is.
 *
 * Every existing role was granted by someone, so the default true is right
 * for them, and for every existing INSERT that doesn't name the column.
 * Adding a column with a constant default doesn't rewrite the table.
 *
 * Four new audit actions, written by the payment commands in their
 * transaction:
 *
 * - `payment_refunded`: an admin refunded a payment. target is the buyer,
 *   detail the payment id.
 * - `payment_product_updated`: an admin changed whether a product is offered
 *   or its kind. detail is the product id.
 * - `payment_product_roles_changed`: a superAdmin set the roles a product
 *   grants. detail is the product id.
 * - `payment_catalog_synced`: an admin pulled the catalog from Stripe. No
 *   detail.
 *
 * This replaces audit_log_action_check (0018) under the same name, the same
 * way 0015 did; see there for why it is one statement and validated right
 * away. Adding an action still means a new migration that replaces it again.
 *
 * The timestamps have no defaults: the application sets them from the
 * Effect clock.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE user_roles
      ADD COLUMN manual boolean NOT NULL DEFAULT true
  `;

  // The Stripe customer of a user, one per mode: test-mode and live-mode
  // customers are different objects in Stripe. Created by the application
  // at the user's first checkout. A customer belongs to one user
  // (stripe_customers_customer_id_key), which also serves the lookup of the
  // user from a webhook. The primary key serves the lookup of a user's
  // customer.
  yield* sql`
    CREATE TABLE stripe_customers (
      user_id uuid NOT NULL,
      livemode boolean NOT NULL,
      customer_id text NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT stripe_customers_user_id_livemode_pkey
        PRIMARY KEY (user_id, livemode),
      CONSTRAINT stripe_customers_customer_id_key UNIQUE (customer_id),
      CONSTRAINT stripe_customers_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id)
    )
  `;

  // Products as mirrored from Stripe. id is the Stripe product id. name,
  // description and active (in Stripe) come from Stripe and are overwritten
  // by every webhook and sync; enabled (offered on our site, off until an
  // admin enables it) and kind are ours and never overwritten.
  //
  // kind is `standard` (grants the roles in payment_product_roles) or `tip`
  // (a tip with preset or custom amounts, grants nothing). There is at most
  // one tip product per mode (payment_products_livemode_tip_key). The
  // application maps a violation of it to a 409; keep the name stable.
  // That a tip product has no roles needs a look at payment_product_roles
  // (a trigger), so the application guarantees it.
  yield* sql`
    CREATE TABLE payment_products (
      id text NOT NULL,
      name text NOT NULL,
      description text NULL,
      active boolean NOT NULL,
      livemode boolean NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      kind text NOT NULL DEFAULT 'standard',
      updated_at timestamptz NOT NULL,
      CONSTRAINT payment_products_id_pkey PRIMARY KEY (id),
      CONSTRAINT payment_products_kind_check
        CHECK (kind IN ('standard', 'tip'))
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX payment_products_livemode_tip_key
      ON payment_products (livemode)
      WHERE kind = 'tip'
  `;

  // The roles a product grants while its buyer is entitled to it. Set by a
  // superAdmin; deleted with the product.
  //
  // role is limited to the purchasable roles (the contract's
  // `PurchasableRole`) by payment_product_roles_role_check, deliberately
  // narrower than user_roles_role_check: the database refuses to let a
  // payment grant normalUser, admin, superAdmin or a blogEditor role even if
  // the application is wrong. Making another role purchasable means a new
  // migration that drops and re-adds payment_product_roles_role_check under
  // the same name with the extended list (and the matching change to
  // `PurchasableRole`).
  //
  // The primary key, leading with product_id, serves the lookup of a
  // product's roles and the CASCADE.
  yield* sql`
    CREATE TABLE payment_product_roles (
      product_id text NOT NULL,
      role text NOT NULL,
      CONSTRAINT payment_product_roles_product_id_role_pkey
        PRIMARY KEY (product_id, role),
      CONSTRAINT payment_product_roles_product_id_fkey FOREIGN KEY (product_id)
        REFERENCES payment_products (id) ON DELETE CASCADE,
      CONSTRAINT payment_product_roles_role_check
        CHECK (role IN ('foodPlanner'))
    )
  `;

  // Prices as mirrored from Stripe. id is the Stripe price id. Stripe only
  // archives prices, so a price row is never deleted, and its product must
  // be mirrored first (payment_prices_product_id_fkey).
  //
  // unit_amount is NULL for a price without a fixed amount (tiered or
  // customer-chosen in Stripe); such a price is never offered. A recurring
  // price has its interval and interval count, a one-time price neither
  // (payment_prices_recurring_check).
  yield* sql`
    CREATE TABLE payment_prices (
      id text NOT NULL,
      product_id text NOT NULL,
      active boolean NOT NULL,
      currency text NOT NULL,
      unit_amount integer NULL,
      recurring_interval text NULL,
      recurring_interval_count integer NULL,
      livemode boolean NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT payment_prices_id_pkey PRIMARY KEY (id),
      CONSTRAINT payment_prices_product_id_fkey FOREIGN KEY (product_id)
        REFERENCES payment_products (id),
      CONSTRAINT payment_prices_currency_check
        CHECK (currency ~ '^[a-z]{3}$'),
      CONSTRAINT payment_prices_unit_amount_check CHECK (unit_amount >= 0),
      CONSTRAINT payment_prices_recurring_interval_check
        CHECK (recurring_interval IN ('day', 'week', 'month', 'year')),
      CONSTRAINT payment_prices_recurring_interval_count_check
        CHECK (recurring_interval_count > 0),
      CONSTRAINT payment_prices_recurring_check
        CHECK (
          (recurring_interval IS NULL) = (recurring_interval_count IS NULL)
        )
    )
  `;

  // A product's prices, for the catalog.
  yield* sql`
    CREATE INDEX payment_prices_product_id_idx ON payment_prices (product_id)
  `;

  // Subscriptions as mirrored from Stripe. id is the Stripe subscription
  // id. status is Stripe's, camelCased as in the contract's
  // `SubscriptionStatus`; only `active` and `trialing` entitle the user to
  // the product's roles. product_id and price_id are those of the
  // subscription's (single) item, NULL until known.
  yield* sql`
    CREATE TABLE payment_subscriptions (
      id text NOT NULL,
      user_id uuid NULL,
      customer_id text NOT NULL,
      product_id text NULL,
      price_id text NULL,
      status text NOT NULL,
      current_period_end timestamptz NULL,
      cancel_at_period_end boolean NOT NULL,
      canceled_at timestamptz NULL,
      livemode boolean NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT payment_subscriptions_id_pkey PRIMARY KEY (id),
      CONSTRAINT payment_subscriptions_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id),
      CONSTRAINT payment_subscriptions_status_check
        CHECK (
          status IN (
            'incomplete',
            'incompleteExpired',
            'trialing',
            'active',
            'pastDue',
            'canceled',
            'unpaid',
            'paused'
          )
        )
    )
  `;

  // A user's subscriptions (their own page, the entitlement check and the
  // cancellation on account deletion).
  yield* sql`
    CREATE INDEX payment_subscriptions_user_id_idx
      ON payment_subscriptions (user_id)
  `;

  // The admin list, newest first; id makes the cursor order total.
  yield* sql`
    CREATE INDEX payment_subscriptions_created_at_id_idx
      ON payment_subscriptions (created_at DESC, id)
  `;

  // The entitled subscriptions of a product, for revoking or granting its
  // roles when an admin changes them, and for the recurring revenue.
  yield* sql`
    CREATE INDEX payment_subscriptions_product_id_active_idx
      ON payment_subscriptions (product_id)
      WHERE status IN ('active', 'trialing')
  `;

  // One row per payment: a one-off purchase or a tip (a paid Checkout
  // session), or one invoice of a subscription. id is generated by the
  // application (UUID v4). kind and status are camelCased as in the
  // contract's `PaymentKind` and `PaymentStatus`.
  //
  // A payment is identified at Stripe by its Checkout session (purchases
  // and tips) or by its invoice (subscriptions), so it has at least one of
  // them (payments_reference_check), and exactly the subscription payments
  // have an invoice (payments_kind_invoice_id_check). Webhooks upsert on
  // these unique keys, and the refund and dispute webhooks find a payment by
  // payment_intent_id; keep the names stable. The payment intent is NULL
  // until Stripe has one. subscription_id and product_id refer to Stripe
  // without foreign keys (see above).
  //
  // amount_refunded is what has been refunded so far, never more than the
  // amount (payments_amount_refunded_check).
  yield* sql`
    CREATE TABLE payments (
      id uuid NOT NULL,
      user_id uuid NULL,
      kind text NOT NULL,
      product_id text NULL,
      checkout_session_id text NULL,
      invoice_id text NULL,
      subscription_id text NULL,
      payment_intent_id text NULL,
      amount integer NOT NULL,
      amount_refunded integer NOT NULL DEFAULT 0,
      currency text NOT NULL,
      status text NOT NULL,
      livemode boolean NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT payments_id_pkey PRIMARY KEY (id),
      CONSTRAINT payments_checkout_session_id_key UNIQUE (checkout_session_id),
      CONSTRAINT payments_invoice_id_key UNIQUE (invoice_id),
      CONSTRAINT payments_payment_intent_id_key UNIQUE (payment_intent_id),
      CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id),
      CONSTRAINT payments_kind_check
        CHECK (kind IN ('purchase', 'tip', 'subscription')),
      CONSTRAINT payments_amount_check CHECK (amount >= 0),
      CONSTRAINT payments_amount_refunded_check
        CHECK (amount_refunded >= 0 AND amount_refunded <= amount),
      CONSTRAINT payments_currency_check CHECK (currency ~ '^[a-z]{3}$'),
      CONSTRAINT payments_status_check
        CHECK (
          status IN (
            'pending',
            'paid',
            'failed',
            'refunded',
            'partiallyRefunded',
            'disputed',
            'disputeLost'
          )
        ),
      CONSTRAINT payments_reference_check
        CHECK (checkout_session_id IS NOT NULL OR invoice_id IS NOT NULL),
      CONSTRAINT payments_kind_invoice_id_check
        CHECK ((kind = 'subscription') = (invoice_id IS NOT NULL))
    )
  `;

  // A user's payments, newest first.
  yield* sql`
    CREATE INDEX payments_user_id_created_at_idx
      ON payments (user_id, created_at DESC)
  `;

  // The admin list, newest first; id makes the cursor order total.
  yield* sql`
    CREATE INDEX payments_created_at_id_idx
      ON payments (created_at DESC, id)
  `;

  // The webhook events already handled, by Stripe event id: Stripe delivers
  // an event at least once, so a handler inserts its id in the transaction
  // that applies it and skips the event when the id is there already.
  yield* sql`
    CREATE TABLE stripe_events (
      id text NOT NULL,
      type text NOT NULL,
      livemode boolean NOT NULL,
      received_at timestamptz NOT NULL,
      CONSTRAINT stripe_events_id_pkey PRIMARY KEY (id)
    )
  `;

  // Only widens the old check, so every existing row satisfies it.
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
            'contact_message_deleted',
            'blog_created',
            'blog_updated',
            'post_deleted',
            'project_created',
            'project_updated',
            'project_deleted',
            'blog_request_approved',
            'blog_request_rejected',
            'category_created',
            'category_renamed',
            'category_merged',
            'category_deleted',
            'payment_refunded',
            'payment_product_updated',
            'payment_product_roles_changed',
            'payment_catalog_synced'
          )
        )
  `;
});
