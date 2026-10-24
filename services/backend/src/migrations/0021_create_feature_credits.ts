import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Feature credits: single uses of a feature, granted by one-off purchases,
 * and the fixed role `mealPlanBuyer`.
 *
 * Today the only feature is `mealPlan`: one credit is one meal plan. A
 * superAdmin sets the credits one purchase of a product grants, kept as a
 * version history (payment_product_credits); the payment webhooks then
 * insert one feature_credits row per single use. meal_plans gets
 * started_at, from which on a plan's credit stays used. Using the feature consumes a credit,
 * a failed use gives it back, and a payment that stops granting access (a
 * full refund, a lost dispute, a mode switch, the account's deletion)
 * revokes its credits; used ones stay used. Credits never expire.
 *
 * `mealPlanBuyer` is held because of a payment (user_roles.manual = false,
 * see 0020) by anyone with a mealPlan credit that is not revoked. It grants
 * reading food data and one's own meal plans, and requesting plans with
 * credits. The application grants and revokes it as credits are granted and
 * revoked, never a product directly: payment_product_roles_role_check (0020)
 * deliberately stays as it is. Like `foodPlanner` in 0019, user_roles and
 * user_role_changes must accept it, so this replaces user_roles_role_check
 * and user_role_changes_role_check (0019) under the same names, the same
 * way 0012 did; see there for why each is one statement and validated right
 * away. The blogEditor pattern is unchanged.
 *
 * feature is checked against a list in both tables, like the other enums
 * of this schema. Adding a feature means a new migration that drops and
 * re-adds payment_product_credits_feature_check and
 * feature_credits_feature_check under the same names with the extended
 * list.
 *
 * One new audit action, written by the payment commands in their
 * transaction:
 *
 * - `payment_product_credits_changed`: a superAdmin set the credits a
 *   product grants. detail is the product id.
 *
 * This replaces audit_log_action_check (0020) under the same name, the same
 * way 0015 did; see there for why it is one statement and validated right
 * away. Adding an action still means a new migration that replaces it again.
 *
 * Purely additive: two new tables, a nullable column and three widened
 * checks. The timestamps
 * have no defaults: the application sets them from the Effect clock.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Only widens the old checks, so every existing row satisfies them.
  yield* sql`
    ALTER TABLE user_roles
      DROP CONSTRAINT user_roles_role_check,
      ADD CONSTRAINT user_roles_role_check
        CHECK (
          role IN (
            'normalUser',
            'admin',
            'superAdmin',
            'foodPlanner',
            'mealPlanBuyer'
          )
          OR (
            role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'
            AND char_length(role) <= 75
          )
        )
  `;
  yield* sql`
    ALTER TABLE user_role_changes
      DROP CONSTRAINT user_role_changes_role_check,
      ADD CONSTRAINT user_role_changes_role_check
        CHECK (
          role IN (
            'normalUser',
            'admin',
            'superAdmin',
            'foodPlanner',
            'mealPlanBuyer'
          )
          OR (
            role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'
            AND char_length(role) <= 75
          )
        )
  `;

  // The credits one one-off purchase of a product grants, per feature, as a
  // version history. A superAdmin setting a product's credits inserts a new
  // version with since = now; rows are only ever inserted, never updated,
  // and deleted only with the product (like payment_product_roles). A
  // purchase gets the quantity of the latest version at or before the time
  // its checkout started, so changing the credits is never retroactive.
  // Credits already granted are separate rows in feature_credits and stay.
  //
  // quantity is at most 100 (payment_product_credits_quantity_check), a
  // sanity bound against a typo, not a business rule. 0 is a removal: from
  // since on, the product grants none of this feature, while purchases
  // started earlier still get the version before. A product without any
  // version of a feature grants none of it.
  //
  // The primary key (product_id, feature, since) serves "the latest version
  // per product and feature at or before a time" (ORDER BY since DESC
  // LIMIT 1, or DISTINCT ON), the history of a product, and the CASCADE.
  yield* sql`
    CREATE TABLE payment_product_credits (
      product_id text NOT NULL,
      feature text NOT NULL,
      quantity integer NOT NULL,
      since timestamptz NOT NULL,
      CONSTRAINT payment_product_credits_product_id_feature_since_pkey
        PRIMARY KEY (product_id, feature, since),
      CONSTRAINT payment_product_credits_product_id_fkey
        FOREIGN KEY (product_id)
        REFERENCES payment_products (id) ON DELETE CASCADE,
      CONSTRAINT payment_product_credits_feature_check
        CHECK (feature IN ('mealPlan')),
      CONSTRAINT payment_product_credits_quantity_check
        CHECK (quantity BETWEEN 0 AND 100)
    )
  `;

  // One row per single use of a feature. id is generated by the application
  // (UUID v4). payment_id is the one-off purchase that granted the credit,
  // and seq its number among that payment's credits of the feature
  // (1..quantity, feature_credits_seq_check). The webhook inserts the
  // credits of a payment with ON CONFLICT DO NOTHING on
  // feature_credits_payment_id_feature_seq_key, so syncing a payment again
  // never grants twice; keep the name stable. That key, leading with
  // payment_id, also serves the lookup of a payment's credits (revoke and
  // grant again) and the foreign key.
  //
  // The foreign keys are plain (no CASCADE or SET NULL), like those of
  // payments (0020): accounts are deleted as tombstones and payments are
  // never deleted, so credits are kept with them.
  //
  // A credit is available while consumed_at and revoked_at are both NULL.
  // Consuming it sets consumed_at and used_for together, the id of what it
  // was used for (a meal plan's id), and giving it back after a failed use
  // clears both (feature_credits_consumed_check). used_for has no foreign
  // key: it refers to a different table per feature. revoked_at is set when
  // the credit's payment stops granting access and cleared if it grants
  // again; consumed credits keep consumed_at and used_for.
  yield* sql`
    CREATE TABLE feature_credits (
      id uuid NOT NULL,
      user_id uuid NOT NULL,
      payment_id uuid NOT NULL,
      feature text NOT NULL,
      seq integer NOT NULL,
      granted_at timestamptz NOT NULL,
      consumed_at timestamptz NULL,
      used_for uuid NULL,
      revoked_at timestamptz NULL,
      CONSTRAINT feature_credits_id_pkey PRIMARY KEY (id),
      CONSTRAINT feature_credits_payment_id_feature_seq_key
        UNIQUE (payment_id, feature, seq),
      CONSTRAINT feature_credits_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id),
      CONSTRAINT feature_credits_payment_id_fkey FOREIGN KEY (payment_id)
        REFERENCES payments (id),
      CONSTRAINT feature_credits_feature_check
        CHECK (feature IN ('mealPlan')),
      CONSTRAINT feature_credits_seq_check CHECK (seq >= 1),
      CONSTRAINT feature_credits_consumed_check
        CHECK ((consumed_at IS NULL) = (used_for IS NULL))
    )
  `;

  // One credit per use: giving a credit back after a failed use finds it by
  // used_for. The uniqueness is a safety net: a use can't take two credits,
  // and the application never tries, so nothing maps a violation.
  yield* sql`
    CREATE UNIQUE INDEX feature_credits_feature_used_for_key
      ON feature_credits (feature, used_for)
      WHERE used_for IS NOT NULL
  `;

  // Consuming picks a user's oldest available credit of a feature, and
  // counting the available ones (and whether the user still deserves
  // mealPlanBuyer) reads the same rows.
  yield* sql`
    CREATE INDEX feature_credits_user_id_feature_granted_at_available_idx
      ON feature_credits (user_id, feature, granted_at)
      WHERE consumed_at IS NULL AND revoked_at IS NULL
  `;

  // A user's credits, newest first (their own page, revoking on account
  // deletion), and the user foreign key.
  yield* sql`
    CREATE INDEX feature_credits_user_id_granted_at_idx
      ON feature_credits (user_id, granted_at DESC)
  `;

  // When the background job started writing the plan, set before it calls
  // Claude. A plan deleted or abandoned after it started keeps its credit
  // consumed. NULL for plans that haven't started, and for every plan from
  // before 0021. A nullable column without a default doesn't rewrite the table.
  yield* sql`
    ALTER TABLE meal_plans
      ADD COLUMN started_at timestamptz NULL
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
            'payment_catalog_synced',
            'payment_product_credits_changed'
          )
        )
  `;
});
