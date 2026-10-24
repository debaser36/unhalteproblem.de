import {
  CreditFeature,
  PaymentId,
  PaymentKind,
  PaymentStatus,
  ProductKind,
  PurchasableRole,
  RecurringInterval,
  SubscriptionStatus,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import type {
  CreditQuantity,
  ProductCreditOffer,
} from "#domains/credits/Credit";
import { UserId } from "#domains/users/User";
import { countDeleted, dieOnSchemaError } from "#infrastructure/Sql";

// Rows as stored. Stripe ids are plain strings here: they come from Stripe
// and were checked by the contract where users send them.

export const ProductRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
  active: Schema.Boolean,
  livemode: Schema.Boolean,
  enabled: Schema.Boolean,
  kind: ProductKind,
  updatedAt: Schema.DateTimeUtcFromDate,
});
export type ProductRow = typeof ProductRow.Type;

export const PriceRow = Schema.Struct({
  id: Schema.String,
  productId: Schema.String,
  active: Schema.Boolean,
  currency: Schema.String,
  unitAmount: Schema.OptionFromNullOr(Schema.Int),
  recurringInterval: Schema.OptionFromNullOr(RecurringInterval),
  recurringIntervalCount: Schema.OptionFromNullOr(Schema.Int),
  livemode: Schema.Boolean,
  updatedAt: Schema.DateTimeUtcFromDate,
});
export type PriceRow = typeof PriceRow.Type;

export const SubscriptionRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.OptionFromNullOr(UserId),
  customerId: Schema.String,
  productId: Schema.OptionFromNullOr(Schema.String),
  priceId: Schema.OptionFromNullOr(Schema.String),
  status: SubscriptionStatus,
  currentPeriodEnd: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
  cancelAtPeriodEnd: Schema.Boolean,
  canceledAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
  livemode: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});
export type SubscriptionRow = typeof SubscriptionRow.Type;

export const PaymentRow = Schema.Struct({
  id: PaymentId,
  userId: Schema.OptionFromNullOr(UserId),
  kind: PaymentKind,
  productId: Schema.OptionFromNullOr(Schema.String),
  checkoutSessionId: Schema.OptionFromNullOr(Schema.String),
  invoiceId: Schema.OptionFromNullOr(Schema.String),
  subscriptionId: Schema.OptionFromNullOr(Schema.String),
  paymentIntentId: Schema.OptionFromNullOr(Schema.String),
  amount: Schema.Int,
  amountRefunded: Schema.Int,
  currency: Schema.String,
  status: PaymentStatus,
  livemode: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});
export type PaymentRow = typeof PaymentRow.Type;

/** A position in a newest-first list: the last row seen. */
export interface PagePosition {
  readonly createdAt: DateTime.Utc;
  readonly id: string;
}

export interface PageQuery<Status> {
  readonly livemode: boolean;
  readonly limit: number;
  readonly after: Option.Option<PagePosition>;
  readonly userId: Option.Option<UserId>;
  readonly status: Option.Option<Status>;
}

const Money = Schema.Struct({ currency: Schema.String, amount: Schema.Finite });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Customers

  const customerOf = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String, livemode: Schema.Boolean }),
    Result: Schema.Struct({ customerId: Schema.String }),
    execute: ({ userId, livemode }) => sql`
      SELECT customer_id FROM stripe_customers
      WHERE user_id = ${userId} AND livemode = ${livemode}
    `,
  });

  const insertCustomer = SqlSchema.void({
    Request: Schema.Struct({
      userId: Schema.String,
      livemode: Schema.Boolean,
      customerId: Schema.String,
      createdAt: Schema.DateTimeUtcFromDate,
    }),
    execute: (row) => sql`
      INSERT INTO stripe_customers ${sql.insert(row)}
      ON CONFLICT DO NOTHING
    `,
  });

  const userOfCustomer = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ userId: UserId }),
    execute: (customerId) => sql`
      SELECT user_id FROM stripe_customers WHERE customer_id = ${customerId}
    `,
  });

  // Catalog

  const upsertProduct = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
      active: Schema.Boolean,
      livemode: Schema.Boolean,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    // `enabled`, `kind` and the roles are ours and stay as they are.
    execute: (row) => sql`
      INSERT INTO payment_products ${sql.insert(row)}
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        active = EXCLUDED.active,
        updated_at = EXCLUDED.updated_at
    `,
  });

  const upsertPrice = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      productId: Schema.String,
      active: Schema.Boolean,
      currency: Schema.String,
      unitAmount: Schema.NullOr(Schema.Int),
      recurringInterval: Schema.NullOr(RecurringInterval),
      recurringIntervalCount: Schema.NullOr(Schema.Int),
      livemode: Schema.Boolean,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: (row) => sql`
      INSERT INTO payment_prices ${sql.insert(row)}
      ON CONFLICT (id) DO UPDATE SET
        active = EXCLUDED.active,
        currency = EXCLUDED.currency,
        unit_amount = EXCLUDED.unit_amount,
        recurring_interval = EXCLUDED.recurring_interval,
        recurring_interval_count = EXCLUDED.recurring_interval_count,
        updated_at = EXCLUDED.updated_at
    `,
  });

  const findProduct = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProductRow,
    execute: (id) => sql`SELECT * FROM payment_products WHERE id = ${id}`,
  });

  const findProductForUpdate = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProductRow,
    execute: (id) =>
      sql`SELECT * FROM payment_products WHERE id = ${id} FOR UPDATE`,
  });

  const productsOf = SqlSchema.findAll({
    Request: Schema.Boolean,
    Result: ProductRow,
    execute: (livemode) => sql`
      SELECT * FROM payment_products WHERE livemode = ${livemode}
      ORDER BY name, id
    `,
  });

  const pricesOf = SqlSchema.findAll({
    Request: Schema.Struct({ productIds: Schema.Array(Schema.String) }),
    Result: PriceRow,
    execute: ({ productIds }) => sql`
      SELECT * FROM payment_prices WHERE ${sql.in("product_id", productIds)}
      ORDER BY unit_amount NULLS LAST, id
    `,
  });

  const rolesOf = SqlSchema.findAll({
    Request: Schema.Struct({ productIds: Schema.Array(Schema.String) }),
    Result: Schema.Struct({ productId: Schema.String, role: PurchasableRole }),
    execute: ({ productIds }) => sql`
      SELECT product_id, role FROM payment_product_roles
      WHERE ${sql.in("product_id", productIds)}
      ORDER BY role
    `,
  });

  const creditsOf = SqlSchema.findAll({
    Request: Schema.Struct({ productIds: Schema.Array(Schema.String) }),
    Result: Schema.Struct({
      productId: Schema.String,
      feature: CreditFeature,
      quantity: Schema.Int,
      since: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ productIds }) => sql`
      SELECT product_id, feature, quantity, since FROM payment_product_credits
      WHERE ${sql.in("product_id", productIds)}
      ORDER BY feature, since
    `,
  });

  const findPrice = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: PriceRow,
    execute: (id) => sql`SELECT * FROM payment_prices WHERE id = ${id}`,
  });

  const findTipProduct = SqlSchema.findOneOption({
    Request: Schema.Boolean,
    Result: ProductRow,
    execute: (livemode) => sql`
      SELECT * FROM payment_products
      WHERE livemode = ${livemode} AND kind = 'tip'
    `,
  });

  const updateProductSettings = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      enabled: Schema.Boolean,
      kind: ProductKind,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ id, enabled, kind, updatedAt }) => sql`
      UPDATE payment_products
      SET enabled = ${enabled}, kind = ${kind}, updated_at = ${updatedAt}
      WHERE id = ${id}
    `,
  });

  const usersOfProduct = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ userId: UserId }),
    execute: (productId) => sql`
      SELECT user_id FROM payment_subscriptions
      WHERE product_id = ${productId} AND user_id IS NOT NULL
      UNION
      SELECT user_id FROM payments
      WHERE product_id = ${productId} AND kind = 'purchase'
        AND user_id IS NOT NULL
    `,
  });

  // Subscriptions

  const upsertSubscription = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      userId: Schema.NullOr(Schema.String),
      customerId: Schema.String,
      productId: Schema.NullOr(Schema.String),
      priceId: Schema.NullOr(Schema.String),
      status: SubscriptionStatus,
      currentPeriodEnd: Schema.NullOr(Schema.DateTimeUtcFromDate),
      cancelAtPeriodEnd: Schema.Boolean,
      canceledAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
      livemode: Schema.Boolean,
      createdAt: Schema.DateTimeUtcFromDate,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: (row) => sql`
      INSERT INTO payment_subscriptions ${sql.insert(row)}
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        customer_id = EXCLUDED.customer_id,
        product_id = EXCLUDED.product_id,
        price_id = EXCLUDED.price_id,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        canceled_at = EXCLUDED.canceled_at,
        updated_at = EXCLUDED.updated_at
    `,
  });

  const findSubscription = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: SubscriptionRow,
    execute: (id) => sql`SELECT * FROM payment_subscriptions WHERE id = ${id}`,
  });

  const subscriptionsOfUser = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String, livemode: Schema.Boolean }),
    Result: SubscriptionRow,
    execute: ({ userId, livemode }) => sql`
      SELECT * FROM payment_subscriptions
      WHERE user_id = ${userId} AND livemode = ${livemode}
      ORDER BY created_at DESC, id DESC
    `,
  });

  const subscriptionPage = SqlSchema.findAll({
    Request: Schema.Struct({
      livemode: Schema.Boolean,
      limit: Schema.Finite,
      after: Schema.NullOr(
        Schema.Struct({
          createdAt: Schema.DateTimeUtcFromDate,
          id: Schema.String,
        }),
      ),
      userId: Schema.NullOr(Schema.String),
      status: Schema.NullOr(SubscriptionStatus),
    }),
    Result: SubscriptionRow,
    execute: ({ livemode, limit, after, userId, status }) => sql`
      SELECT * FROM payment_subscriptions
      WHERE livemode = ${livemode}
      ${after === null ? sql`` : sql`AND (created_at, id) < (${after.createdAt}, ${after.id})`}
      ${userId === null ? sql`` : sql`AND user_id = ${userId}`}
      ${status === null ? sql`` : sql`AND status = ${status}`}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `,
  });

  // Payments

  const PaymentInsert = Schema.Struct({
    id: Schema.String,
    userId: Schema.NullOr(Schema.String),
    kind: PaymentKind,
    productId: Schema.NullOr(Schema.String),
    checkoutSessionId: Schema.NullOr(Schema.String),
    invoiceId: Schema.NullOr(Schema.String),
    subscriptionId: Schema.NullOr(Schema.String),
    paymentIntentId: Schema.NullOr(Schema.String),
    amount: Schema.Int,
    amountRefunded: Schema.Int,
    currency: Schema.String,
    status: PaymentStatus,
    livemode: Schema.Boolean,
    createdAt: Schema.DateTimeUtcFromDate,
    updatedAt: Schema.DateTimeUtcFromDate,
  });

  // One row per checkout session or invoice, whichever event comes first;
  // later ones bring it up to date. The id and `created_at` stay.
  const upsertCheckoutPayment = SqlSchema.void({
    Request: PaymentInsert,
    execute: (row) => sql`
      INSERT INTO payments ${sql.insert(row)}
      ON CONFLICT (checkout_session_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        payment_intent_id = EXCLUDED.payment_intent_id,
        amount = EXCLUDED.amount,
        amount_refunded = EXCLUDED.amount_refunded,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `,
  });

  const upsertInvoicePayment = SqlSchema.void({
    Request: PaymentInsert,
    execute: (row) => sql`
      INSERT INTO payments ${sql.insert(row)}
      ON CONFLICT (invoice_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        product_id = EXCLUDED.product_id,
        subscription_id = EXCLUDED.subscription_id,
        payment_intent_id = EXCLUDED.payment_intent_id,
        amount = EXCLUDED.amount,
        amount_refunded = EXCLUDED.amount_refunded,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `,
  });

  const updateIntentState = SqlSchema.findAll({
    Request: Schema.Struct({
      paymentIntentId: Schema.String,
      status: PaymentStatus,
      amountRefunded: Schema.Int,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ userId: Schema.NullOr(UserId) }),
    execute: ({ paymentIntentId, status, amountRefunded, updatedAt }) => sql`
      UPDATE payments
      SET status = ${status},
        amount_refunded = LEAST(${amountRefunded}, amount),
        updated_at = ${updatedAt}
      WHERE payment_intent_id = ${paymentIntentId}
      RETURNING user_id
    `,
  });

  const findPayment = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: PaymentRow,
    execute: (id) => sql`SELECT * FROM payments WHERE id = ${id}::uuid`,
  });

  const paymentsOfUser = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String, livemode: Schema.Boolean }),
    Result: PaymentRow,
    execute: ({ userId, livemode }) => sql`
      SELECT * FROM payments
      WHERE user_id = ${userId} AND livemode = ${livemode}
      ORDER BY created_at DESC, id DESC
    `,
  });

  const paymentPage = SqlSchema.findAll({
    Request: Schema.Struct({
      livemode: Schema.Boolean,
      limit: Schema.Finite,
      after: Schema.NullOr(
        Schema.Struct({
          createdAt: Schema.DateTimeUtcFromDate,
          id: Schema.String,
        }),
      ),
      userId: Schema.NullOr(Schema.String),
      status: Schema.NullOr(PaymentStatus),
    }),
    Result: PaymentRow,
    execute: ({ livemode, limit, after, userId, status }) => sql`
      SELECT * FROM payments
      WHERE livemode = ${livemode}
      ${after === null ? sql`` : sql`AND (created_at, id) < (${after.createdAt}, ${after.id}::uuid)`}
      ${userId === null ? sql`` : sql`AND user_id = ${userId}`}
      ${status === null ? sql`` : sql`AND status = ${status}`}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `,
  });

  // Insights: money that stayed, i.e. paid minus refunded.
  const revenue = SqlSchema.findAll({
    Request: Schema.Struct({
      livemode: Schema.Boolean,
      since: Schema.NullOr(Schema.DateTimeUtcFromDate),
    }),
    Result: Money,
    execute: ({ livemode, since }) => sql`
      SELECT currency, sum(amount - amount_refunded)::float8 AS amount
      FROM payments
      WHERE livemode = ${livemode}
        AND status IN ('paid', 'partiallyRefunded', 'disputed')
        ${since === null ? sql`` : sql`AND created_at >= ${since}`}
      GROUP BY currency
    `,
  });

  const refunded = SqlSchema.findAll({
    Request: Schema.Boolean,
    Result: Money,
    execute: (livemode) => sql`
      SELECT currency, sum(amount_refunded)::float8 AS amount
      FROM payments
      WHERE livemode = ${livemode} AND amount_refunded > 0
      GROUP BY currency
    `,
  });

  const activeRecurring = SqlSchema.findAll({
    Request: Schema.Boolean,
    Result: Schema.Struct({
      currency: Schema.String,
      unitAmount: Schema.Int,
      recurringInterval: RecurringInterval,
      recurringIntervalCount: Schema.Int,
    }),
    execute: (livemode) => sql`
      SELECT p.currency, p.unit_amount, p.recurring_interval,
        p.recurring_interval_count
      FROM payment_subscriptions s
      JOIN payment_prices p ON p.id = s.price_id
      WHERE s.livemode = ${livemode} AND s.status IN ('active', 'trialing')
        AND p.unit_amount IS NOT NULL AND p.recurring_interval IS NOT NULL
    `,
  });

  const activeSubscriptions = SqlSchema.findAll({
    Request: Schema.Boolean,
    Result: Schema.Struct({ count: Schema.Int }),
    execute: (livemode) => sql`
      SELECT count(*)::int AS count FROM payment_subscriptions
      WHERE livemode = ${livemode} AND status IN ('active', 'trialing')
    `,
  });

  // Webhook deliveries

  const recordEvent = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      type: Schema.String,
      livemode: Schema.Boolean,
      receivedAt: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: (row) => sql`
      INSERT INTO stripe_events ${sql.insert(row)}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `,
  });

  const span =
    (name: string) =>
    <A>(self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError>) =>
      dieOnSchemaError(self).pipe(Effect.withSpan(`PaymentRepository.${name}`));

  const toAfter = (after: Option.Option<PagePosition>) =>
    Option.getOrNull(after);

  return PaymentRepository.of({
    customerOf: (userId, livemode) =>
      customerOf({ userId, livemode }).pipe(
        Effect.map(Option.map(({ customerId }) => customerId)),
        span("customerOf"),
      ),
    insertCustomer: (row) => insertCustomer(row).pipe(span("insertCustomer")),
    userOfCustomer: (customerId) =>
      userOfCustomer(customerId).pipe(
        Effect.map(Option.map(({ userId }) => userId)),
        span("userOfCustomer"),
      ),

    upsertProduct: (row) =>
      upsertProduct({
        ...row,
        description: Option.getOrNull(row.description),
      }).pipe(span("upsertProduct")),
    upsertPrice: (row) =>
      upsertPrice({
        ...row,
        unitAmount: Option.getOrNull(row.unitAmount),
        recurringInterval: Option.getOrNull(row.recurringInterval),
        recurringIntervalCount: Option.getOrNull(row.recurringIntervalCount),
      }).pipe(span("upsertPrice")),
    deactivateProduct: (id, at) =>
      sql`
        UPDATE payment_products
        SET active = false, updated_at = ${DateTime.toDateUtc(at)}
        WHERE id = ${id}
      `.pipe(
        Effect.asVoid,
        Effect.withSpan("PaymentRepository.deactivateProduct"),
      ),
    findProduct: (id) => findProduct(id).pipe(span("findProduct")),
    findProductForUpdate: (id) =>
      findProductForUpdate(id).pipe(span("findProductForUpdate")),
    products: (livemode) => productsOf(livemode).pipe(span("products")),
    pricesOf: (productIds) =>
      productIds.length === 0
        ? Effect.succeed([])
        : pricesOf({ productIds }).pipe(span("pricesOf")),
    rolesOf: (productIds) =>
      productIds.length === 0
        ? Effect.succeed(new Map())
        : rolesOf({ productIds }).pipe(
            Effect.map((rows) => {
              const map = new Map<string, Array<PurchasableRole>>();
              for (const { productId, role } of rows) {
                map.set(productId, [...(map.get(productId) ?? []), role]);
              }
              return map as ReadonlyMap<string, ReadonlyArray<PurchasableRole>>;
            }),
            span("rolesOf"),
          ),
    creditsOf: (productIds) =>
      productIds.length === 0
        ? Effect.succeed(new Map())
        : creditsOf({ productIds }).pipe(
            Effect.map((rows) => {
              const map = new Map<string, Array<ProductCreditOffer>>();
              for (const { productId, ...offer } of rows) {
                map.set(productId, [...(map.get(productId) ?? []), offer]);
              }
              return map as ReadonlyMap<
                string,
                ReadonlyArray<ProductCreditOffer>
              >;
            }),
            span("creditsOf"),
          ),
    addCreditVersions: (productId, versions, at) =>
      versions.length === 0
        ? Effect.void
        : sql`
            INSERT INTO payment_product_credits
            ${sql.insert(
              versions.map(({ feature, quantity }) => ({
                productId,
                feature,
                quantity,
                since: DateTime.toDateUtc(at),
              })),
            )}
            ON CONFLICT (product_id, feature, since) DO UPDATE
            SET quantity = EXCLUDED.quantity
          `.pipe(Effect.asVoid, span("addCreditVersions")),
    findPrice: (id) => findPrice(id).pipe(span("findPrice")),
    findTipProduct: (livemode) =>
      findTipProduct(livemode).pipe(span("findTipProduct")),
    updateProductSettings: (row) =>
      updateProductSettings(row).pipe(span("updateProductSettings")),
    setProductRoles: Effect.fn("PaymentRepository.setProductRoles")(function* (
      productId: string,
      roles: ReadonlyArray<PurchasableRole>,
    ) {
      yield* sql`
          DELETE FROM payment_product_roles WHERE product_id = ${productId}
        `;
      if (roles.length > 0) {
        yield* sql`
            INSERT INTO payment_product_roles
            ${sql.insert(roles.map((role) => ({ productId, role })))}
          `;
      }
    }),
    usersOfProduct: (productId) =>
      usersOfProduct(productId).pipe(
        Effect.map((rows) => rows.map(({ userId }) => userId)),
        span("usersOfProduct"),
      ),

    upsertSubscription: (row) =>
      upsertSubscription({
        ...row,
        userId: Option.getOrNull(row.userId),
        productId: Option.getOrNull(row.productId),
        priceId: Option.getOrNull(row.priceId),
        currentPeriodEnd: Option.getOrNull(row.currentPeriodEnd),
        canceledAt: Option.getOrNull(row.canceledAt),
      }).pipe(span("upsertSubscription")),
    findSubscription: (id) =>
      findSubscription(id).pipe(span("findSubscription")),
    subscriptionsOfUser: (userId, livemode) =>
      subscriptionsOfUser({ userId, livemode }).pipe(
        span("subscriptionsOfUser"),
      ),
    subscriptionPage: (query) =>
      subscriptionPage({
        livemode: query.livemode,
        limit: query.limit,
        after: toAfter(query.after),
        userId: Option.getOrNull(query.userId),
        status: Option.getOrNull(query.status),
      }).pipe(span("subscriptionPage")),

    upsertPayment: (row) => {
      const insert = {
        ...row,
        userId: Option.getOrNull(row.userId),
        productId: Option.getOrNull(row.productId),
        checkoutSessionId: Option.getOrNull(row.checkoutSessionId),
        invoiceId: Option.getOrNull(row.invoiceId),
        subscriptionId: Option.getOrNull(row.subscriptionId),
        paymentIntentId: Option.getOrNull(row.paymentIntentId),
      };
      return (
        Option.isSome(row.invoiceId)
          ? upsertInvoicePayment(insert)
          : upsertCheckoutPayment(insert)
      ).pipe(span("upsertPayment"));
    },
    updateIntentState: (row) =>
      updateIntentState(row).pipe(
        Effect.map((rows) =>
          rows.flatMap(({ userId }) => (userId === null ? [] : [userId])),
        ),
        span("updateIntentState"),
      ),
    findPayment: (id) => findPayment(id).pipe(span("findPayment")),
    paymentsOfUser: (userId, livemode) =>
      paymentsOfUser({ userId, livemode }).pipe(span("paymentsOfUser")),
    paymentPage: (query) =>
      paymentPage({
        livemode: query.livemode,
        limit: query.limit,
        after: toAfter(query.after),
        userId: Option.getOrNull(query.userId),
        status: Option.getOrNull(query.status),
      }).pipe(span("paymentPage")),

    revenue: (livemode, since) =>
      revenue({ livemode, since: Option.getOrNull(since) }).pipe(
        span("revenue"),
      ),
    refunded: (livemode) => refunded(livemode).pipe(span("refunded")),
    activeRecurring: (livemode) =>
      activeRecurring(livemode).pipe(span("activeRecurring")),
    activeSubscriptions: (livemode) =>
      activeSubscriptions(livemode).pipe(
        Effect.map((rows) => rows[0]?.count ?? 0),
        span("activeSubscriptions"),
      ),

    deleteEventsReceivedBefore: (cutoff) =>
      countDeleted(
        sql,
        sql`DELETE FROM stripe_events WHERE received_at < ${DateTime.toDateUtc(cutoff)}`,
      ).pipe(Effect.withSpan("PaymentRepository.deleteEventsReceivedBefore")),
    recordEvent: (row) =>
      recordEvent(row).pipe(Effect.map(Option.isSome), span("recordEvent")),
  });
});

type Sql<A> = Effect.Effect<A, SqlError.SqlError>;

/**
 * Storage of the payments domain: the Stripe customers of our users, the
 * mirrored catalog with our settings (offered or not, tip product, roles),
 * subscriptions, payments and the webhook events seen. Used only by the
 * payments domain.
 */
export class PaymentRepository extends Context.Service<
  PaymentRepository,
  {
    readonly customerOf: (
      userId: UserId,
      livemode: boolean,
    ) => Sql<Option.Option<string>>;
    /** Stores the customer, unless the user has one in this mode already. */
    readonly insertCustomer: (row: {
      readonly userId: UserId;
      readonly livemode: boolean;
      readonly customerId: string;
      readonly createdAt: DateTime.Utc;
    }) => Sql<void>;
    readonly userOfCustomer: (customerId: string) => Sql<Option.Option<UserId>>;

    /** Inserts or updates Stripe's side of a product; ours stays. */
    readonly upsertProduct: (row: {
      readonly id: string;
      readonly name: string;
      readonly description: Option.Option<string>;
      readonly active: boolean;
      readonly livemode: boolean;
      readonly updatedAt: DateTime.Utc;
    }) => Sql<void>;
    readonly upsertPrice: (row: PriceRow) => Sql<void>;
    /** Marks a product that Stripe no longer has as inactive. */
    readonly deactivateProduct: (id: string, at: DateTime.Utc) => Sql<void>;
    readonly findProduct: (id: string) => Sql<Option.Option<ProductRow>>;
    readonly findProductForUpdate: (
      id: string,
    ) => Sql<Option.Option<ProductRow>>;
    /** Every product of the mode, by name. */
    readonly products: (livemode: boolean) => Sql<ReadonlyArray<ProductRow>>;
    /** The prices of these products, cheapest first. */
    readonly pricesOf: (
      productIds: ReadonlyArray<string>,
    ) => Sql<ReadonlyArray<PriceRow>>;
    /** The roles each of these products grants; products without are absent. */
    readonly rolesOf: (
      productIds: ReadonlyArray<string>,
    ) => Sql<ReadonlyMap<string, ReadonlyArray<PurchasableRole>>>;
    readonly findPrice: (id: string) => Sql<Option.Option<PriceRow>>;
    readonly findTipProduct: (
      livemode: boolean,
    ) => Sql<Option.Option<ProductRow>>;
    readonly updateProductSettings: (row: {
      readonly id: string;
      readonly enabled: boolean;
      readonly kind: ProductKind;
      readonly updatedAt: DateTime.Utc;
    }) => Sql<void>;
    readonly setProductRoles: (
      productId: string,
      roles: ReadonlyArray<PurchasableRole>,
    ) => Sql<void>;
    /**
     * Every version of what each of these products grants per purchase
     * (see `offerAt`); products that never granted credits are absent.
     */
    readonly creditsOf: (
      productIds: ReadonlyArray<string>,
    ) => Sql<ReadonlyMap<string, ReadonlyArray<ProductCreditOffer>>>;
    /** Adds versions of what a product grants per purchase, from `at` on. */
    readonly addCreditVersions: (
      productId: string,
      versions: ReadonlyArray<CreditQuantity>,
      at: DateTime.Utc,
    ) => Sql<void>;
    /** Users with a subscription or a purchase of the product. */
    readonly usersOfProduct: (productId: string) => Sql<ReadonlyArray<UserId>>;

    readonly upsertSubscription: (row: SubscriptionRow) => Sql<void>;
    readonly findSubscription: (
      id: string,
    ) => Sql<Option.Option<SubscriptionRow>>;
    /** Newest first. */
    readonly subscriptionsOfUser: (
      userId: UserId,
      livemode: boolean,
    ) => Sql<ReadonlyArray<SubscriptionRow>>;
    readonly subscriptionPage: (
      query: PageQuery<SubscriptionStatus>,
    ) => Sql<ReadonlyArray<SubscriptionRow>>;

    /**
     * Inserts the payment of a checkout session or an invoice (by
     * `invoiceId` if it has one), or brings the existing row up to date;
     * the stored id and `createdAt` win over the given ones.
     */
    readonly upsertPayment: (row: PaymentRow) => Sql<void>;
    /**
     * Sets status and refunded amount of the payments of a payment intent;
     * returns their users.
     */
    readonly updateIntentState: (row: {
      readonly paymentIntentId: string;
      readonly status: PaymentStatus;
      readonly amountRefunded: number;
      readonly updatedAt: DateTime.Utc;
    }) => Sql<ReadonlyArray<UserId>>;
    readonly findPayment: (id: string) => Sql<Option.Option<PaymentRow>>;
    /** Newest first. */
    readonly paymentsOfUser: (
      userId: UserId,
      livemode: boolean,
    ) => Sql<ReadonlyArray<PaymentRow>>;
    readonly paymentPage: (
      query: PageQuery<PaymentStatus>,
    ) => Sql<ReadonlyArray<PaymentRow>>;

    /** Kept money per currency (paid minus refunded), optionally since then. */
    readonly revenue: (
      livemode: boolean,
      since: Option.Option<DateTime.Utc>,
    ) => Sql<
      ReadonlyArray<{ readonly currency: string; readonly amount: number }>
    >;
    readonly refunded: (
      livemode: boolean,
    ) => Sql<
      ReadonlyArray<{ readonly currency: string; readonly amount: number }>
    >;
    /** The prices of the subscriptions that grant access now. */
    readonly activeRecurring: (livemode: boolean) => Sql<
      ReadonlyArray<{
        readonly currency: string;
        readonly unitAmount: number;
        readonly recurringInterval: RecurringInterval;
        readonly recurringIntervalCount: number;
      }>
    >;
    readonly activeSubscriptions: (livemode: boolean) => Sql<number>;

    /** Forgets webhook events received before then; returns how many. */
    readonly deleteEventsReceivedBefore: (cutoff: DateTime.Utc) => Sql<number>;
    /** Remembers a webhook event; returns false if it was seen before. */
    readonly recordEvent: (row: {
      readonly id: string;
      readonly type: string;
      readonly livemode: boolean;
      readonly receivedAt: DateTime.Utc;
    }) => Sql<boolean>;
  }
>()("@unhalteproblem.de/backend/domains/payments/PaymentRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(PaymentRepository, make);
}
