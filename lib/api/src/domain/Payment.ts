import { UserId } from "#domain/Admin";
import { HttpUrl } from "#domain/HttpUrl";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { DateTime, Effect, Schema, SchemaGetter } from "effect";

// Payments with Stripe: Stripe-hosted Checkout and Customer Portal, products
// and prices created in the Stripe dashboard and mirrored into our database
// by webhooks. Amounts are integers in the currency's minor unit (cents) and
// currency codes are lowercase ISO 4217 (`eur`), like Stripe's.

/** Length limit of Stripe ids, far above what Stripe issues. */
const StripeIdMaxLength = 255;

const stripeId = (prefix: string, identifier: string) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`, "u")),
    Schema.isMaxLength(StripeIdMaxLength),
  ).annotate({
    identifier,
    description: `A Stripe id: \`${prefix}_\` followed by letters and digits.`,
  });

/** The id of a Stripe product, `prod_…`. */
export const StripeProductId = stripeId("prod", "StripeProductId");
export type StripeProductId = typeof StripeProductId.Type;

/** The id of a Stripe price, `price_…`. */
export const StripePriceId = stripeId("price", "StripePriceId");
export type StripePriceId = typeof StripePriceId.Type;

/** The id of a Stripe subscription, `sub_…`. */
export const StripeSubscriptionId = stripeId("sub", "StripeSubscriptionId");
export type StripeSubscriptionId = typeof StripeSubscriptionId.Type;

/** Our own id of a payment (a UUID), assigned by the backend. */
export const PaymentId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("PaymentId"))
  .annotate({
    identifier: "PaymentId",
    description: "Our own id of a payment (a UUID).",
  });
export type PaymentId = typeof PaymentId.Type;

/** A currency: three lowercase letters, an ISO 4217 code such as `eur`. */
export const Currency = Schema.String.check(
  Schema.isPattern(/^[a-z]{3}$/u),
).annotate({
  identifier: "Currency",
  description: "A lowercase ISO 4217 currency code, e.g. `eur`.",
});
export type Currency = typeof Currency.Type;

/**
 * An amount of money in a currency's minor unit (cents): 1999 `eur` is
 * 19.99 EUR. Named `PaymentMoney` because `Money` of the food planner is a
 * plain decimal number.
 */
export const PaymentMoney = Schema.Struct({
  /** In the currency's minor unit; 0 or more. */
  amount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotateKey({
    description: "In the currency's minor unit (cents), 0 or more.",
  }),
  currency: Currency,
}).annotate({
  identifier: "PaymentMoney",
  description:
    "An amount of money: an integer in the currency's minor unit (cents) " +
    "and a lowercase ISO 4217 currency code.",
});
export type PaymentMoney = typeof PaymentMoney.Type;

/**
 * The roles a product may grant: `foodPlanner` only. A subset of
 * `GlobalRole`, and never `normalUser`, `admin`, `superAdmin` or
 * `blogEditor:*`. The database enforces the same with a check constraint.
 */
export const PurchasableRole = Schema.Literals(["foodPlanner"]).annotate({
  identifier: "PurchasableRole",
  description: "A role that a purchase may grant: `foodPlanner`.",
});
export type PurchasableRole = typeof PurchasableRole.Type;

/**
 * What a product is: `standard` (a subscription or a one-off purchase) or
 * `tip` (the one product that takes tips; at most one).
 */
export const ProductKind = Schema.Literals(["standard", "tip"]).annotate({
  identifier: "ProductKind",
  description: "`standard` product, or the `tip` product (at most one).",
});
export type ProductKind = typeof ProductKind.Type;

/** How often a recurring price bills. */
export const RecurringInterval = Schema.Literals([
  "day",
  "week",
  "month",
  "year",
]).annotate({
  identifier: "RecurringInterval",
  description: "The unit of a recurring price's billing period.",
});
export type RecurringInterval = typeof RecurringInterval.Type;

/** A price of a product: a fixed amount, one-time or recurring. */
export const Price = Schema.Struct({
  id: StripePriceId,
  amount: PaymentMoney,
  /** `null` for a one-time price. */
  recurring: Schema.OptionFromNullOr(
    Schema.Struct({
      interval: RecurringInterval,
      intervalCount: Schema.Int.check(Schema.isGreaterThan(0)),
    }).annotate({
      identifier: "Recurring",
      description: "Bills every `intervalCount` `interval`s.",
    }),
  ),
}).annotate({
  identifier: "Price",
  description:
    "A fixed price of a product. `recurring` is null for a one-time price.",
});
export type Price = typeof Price.Type;

/** A product on offer, with the roles it grants and its prices. */
export const CatalogProduct = Schema.Struct({
  id: StripeProductId,
  name: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
  roles: Schema.Array(PurchasableRole),
  prices: Schema.Array(Price),
}).annotate({
  identifier: "CatalogProduct",
  description: "A product on offer, with the roles it grants and its prices.",
});
export type CatalogProduct = typeof CatalogProduct.Type;

/** The tip product: preset amounts and the bounds of a custom amount. */
export const TipOffer = Schema.Struct({
  productId: StripeProductId,
  name: Schema.String,
  /** The one-time prices of the tip product. */
  presets: Schema.Array(Price),
  minimum: PaymentMoney,
  maximum: PaymentMoney,
}).annotate({
  identifier: "TipOffer",
  description:
    "The tip product: preset amounts (its one-time prices) and the bounds " +
    "of a custom amount, in the tip currency.",
});
export type TipOffer = typeof TipOffer.Type;

/**
 * What is on offer: the enabled products that are active in Stripe, with
 * their active prices that have a fixed amount, and the tip product.
 */
export const Catalog = Schema.Struct({
  products: Schema.Array(CatalogProduct),
  tip: Schema.OptionFromNullOr(TipOffer),
}).annotate({
  identifier: "Catalog",
  description:
    "The enabled products that are active in Stripe, with their active " +
    "fixed-amount prices, and the tip product (null if there is none).",
});
export type Catalog = typeof Catalog.Type;

/**
 * Body of `POST /payments/checkout`: buy a price, or tip a custom amount
 * (in the currency of the tip product's presets).
 */
export const CheckoutRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("price"),
    priceId: StripePriceId,
  }).annotate({ identifier: "CheckoutPriceRequest" }),
  Schema.Struct({
    kind: Schema.Literal("tip"),
    /** In the tip currency's minor unit; greater than 0. */
    amount: Schema.Int.check(Schema.isGreaterThan(0)).annotateKey({
      description: "A custom tip in the tip currency's minor unit (cents).",
    }),
  }).annotate({ identifier: "CheckoutTipRequest" }),
]).annotate({
  identifier: "CheckoutRequest",
  description:
    "What to pay for: `{ kind: 'price', priceId }` buys a price of an " +
    "offered product, `{ kind: 'tip', amount }` tips a custom amount.",
});
export type CheckoutRequest = typeof CheckoutRequest.Type;

/** Answer of checkout and portal: where to send the browser. */
export const RedirectUrl = Schema.Struct({ url: HttpUrl }).annotate({
  identifier: "RedirectUrl",
  description: "The Stripe-hosted page to send the browser to.",
});
export type RedirectUrl = typeof RedirectUrl.Type;

/** A subscription's status: Stripe's, camelCased. */
export const SubscriptionStatus = Schema.Literals([
  "incomplete",
  "incompleteExpired",
  "trialing",
  "active",
  "pastDue",
  "canceled",
  "unpaid",
  "paused",
]).annotate({
  identifier: "SubscriptionStatus",
  description: "The status of a subscription, Stripe's in camelCase.",
});
export type SubscriptionStatus = typeof SubscriptionStatus.Type;

/**
 * What a payment is for: a one-off `purchase`, a `tip`, or one paid invoice
 * of a `subscription`.
 */
export const PaymentKind = Schema.Literals([
  "purchase",
  "tip",
  "subscription",
]).annotate({
  identifier: "PaymentKind",
  description:
    "A one-off `purchase`, a `tip`, or one paid invoice of a `subscription`.",
});
export type PaymentKind = typeof PaymentKind.Type;

/** Where a payment stands. */
export const PaymentStatus = Schema.Literals([
  "pending",
  "paid",
  "failed",
  "refunded",
  "partiallyRefunded",
  "disputed",
  "disputeLost",
]).annotate({
  identifier: "PaymentStatus",
  description: "The status of a payment.",
});
export type PaymentStatus = typeof PaymentStatus.Type;

/** A product as a payment or subscription refers to it. */
export const ProductRef = Schema.Struct({
  id: StripeProductId,
  name: Schema.String,
}).annotate({
  identifier: "ProductRef",
  description: "The product of a payment or subscription.",
});
export type ProductRef = typeof ProductRef.Type;

const subscriptionFields = {
  id: StripeSubscriptionId,
  product: Schema.OptionFromNullOr(ProductRef),
  status: SubscriptionStatus,
  price: Schema.OptionFromNullOr(Price),
  currentPeriodEnd: Schema.OptionFromNullOr(IsoDateTimeUtc),
  cancelAtPeriodEnd: Schema.Boolean,
  createdAt: IsoDateTimeUtc,
};

/** A subscription of the caller. */
export const Subscription = Schema.Struct(subscriptionFields).annotate({
  identifier: "Subscription",
  description:
    "A subscription. It grants its product's roles while it is `active` or " +
    "`trialing`.",
});
export type Subscription = typeof Subscription.Type;

const paymentFields = {
  id: PaymentId,
  kind: PaymentKind,
  product: Schema.OptionFromNullOr(ProductRef),
  amount: PaymentMoney,
  /** In the currency of `amount`; at most `amount.amount`. */
  amountRefunded: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  status: PaymentStatus,
  createdAt: IsoDateTimeUtc,
};

/** A payment of the caller. */
export const Payment = Schema.Struct(paymentFields).annotate({
  identifier: "Payment",
  description:
    "A payment: a purchase, a tip or one paid subscription invoice. " +
    "`amountRefunded` is in the currency of `amount`.",
});
export type Payment = typeof Payment.Type;

/** Body of `GET /payments/me`. */
export const MyPayments = Schema.Struct({
  subscriptions: Schema.Array(Subscription),
  payments: Schema.Array(Payment),
}).annotate({
  identifier: "MyPayments",
  description: "The caller's subscriptions and payments, newest first.",
});
export type MyPayments = typeof MyPayments.Type;

/** A payment as admins see it. */
export const AdminPayment = Schema.Struct({
  ...paymentFields,
  /** The buyer; `null` if unknown. */
  userId: Schema.OptionFromNullOr(UserId),
  stripePaymentIntentId: Schema.OptionFromNullOr(Schema.String),
  livemode: Schema.Boolean,
}).annotate({
  identifier: "AdminPayment",
  description: "A payment with its buyer and Stripe references.",
});
export type AdminPayment = typeof AdminPayment.Type;

/** A subscription as admins see it. */
export const AdminSubscription = Schema.Struct({
  ...subscriptionFields,
  /** The subscriber; `null` if unknown. */
  userId: Schema.OptionFromNullOr(UserId),
  livemode: Schema.Boolean,
}).annotate({
  identifier: "AdminSubscription",
  description: "A subscription with its subscriber.",
});
export type AdminSubscription = typeof AdminSubscription.Type;

/** Paging limits of the admin payment lists. */
export const PaymentPageLimits = {
  /** Page size when `limit` is absent. */
  defaultLimit: 50,
  /** Largest page size accepted. */
  maxLimit: 200,
} as const;

/** Longest accepted encoded payment or subscription cursor. */
export const PaymentCursorMaxLength = 128;

/** Decoded form of `PaymentCursor`: the position of one payment. */
export interface PaymentCursorPosition {
  /** `createdAt` of the payment, at millisecond precision. */
  readonly createdAt: DateTime.Utc;
  readonly id: PaymentId;
}

/**
 * Position in the list of payments: the `createdAt` and `id` of the last
 * payment of a page. Opaque to clients, which pass `nextCursor` back as
 * `cursor`. Encoded: base64url (no padding) of the JSON array
 * `[createdAtEpochMillis, paymentId]`; anything else fails decoding (400).
 */
export const PaymentCursor = Schema.String.annotate({
  description:
    "Opaque position in the list of payments: pass the `nextCursor` of a " +
    "page as `cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(PaymentCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Tuple([Schema.DateTimeUtcFromMillis, PaymentId]),
    ),
  ),
  Schema.decodeTo(
    Schema.Struct({
      createdAt: Schema.DateTimeUtc,
      // Only the Type of `PaymentId`: the tuple above has validated it.
      id: Schema.toType(PaymentId),
    }),
    {
      decode: SchemaGetter.transform(([createdAt, id]) => ({ createdAt, id })),
      encode: SchemaGetter.transform(
        ({ createdAt, id }) => [createdAt, id] as const,
      ),
    },
  ),
  Schema.annotate({ identifier: "PaymentCursor" }),
);
export type PaymentCursor = typeof PaymentCursor.Type;

/** Decoded form of `SubscriptionCursor`: the position of one subscription. */
export interface SubscriptionCursorPosition {
  /** `createdAt` of the subscription, at millisecond precision. */
  readonly createdAt: DateTime.Utc;
  readonly id: StripeSubscriptionId;
}

/**
 * Position in the list of subscriptions, like `PaymentCursor` but with the
 * subscription's Stripe id.
 */
export const SubscriptionCursor = Schema.String.annotate({
  description:
    "Opaque position in the list of subscriptions: pass the `nextCursor` " +
    "of a page as `cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(PaymentCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Tuple([Schema.DateTimeUtcFromMillis, StripeSubscriptionId]),
    ),
  ),
  Schema.decodeTo(
    Schema.Struct({
      createdAt: Schema.DateTimeUtc,
      id: Schema.toType(StripeSubscriptionId),
    }),
    {
      decode: SchemaGetter.transform(([createdAt, id]) => ({ createdAt, id })),
      encode: SchemaGetter.transform(
        ({ createdAt, id }) => [createdAt, id] as const,
      ),
    },
  ),
  Schema.annotate({ identifier: "SubscriptionCursor" }),
);
export type SubscriptionCursor = typeof SubscriptionCursor.Type;

const pageLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: PaymentPageLimits.maxLimit }),
)
  // Described on the key, before the default (see `UserPageQuery`).
  .annotateKey({
    description: "Page size, an integer from 1 to 200; 50 if absent.",
  })
  .pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed(PaymentPageLimits.defaultLimit),
    ),
  );

/**
 * Query of `GET /admin/payments`, newest first (by `createdAt`, then `id`).
 * Decoding fills in the default `limit`; in the generated client `limit` is
 * therefore required (pass `PaymentPageLimits.defaultLimit`).
 */
export const AdminPaymentQuery = Schema.Struct({
  limit: pageLimit,
  cursor: Schema.optionalKey(PaymentCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
  userId: Schema.optionalKey(UserId).annotateKey({
    description: "Only payments of this user.",
  }),
  status: Schema.optionalKey(PaymentStatus).annotateKey({
    description: "Only payments with this status.",
  }),
}).annotate({ identifier: "AdminPaymentQuery" });
export type AdminPaymentQuery = typeof AdminPaymentQuery.Type;

/** Query of `GET /admin/payments/subscriptions`. */
export const AdminSubscriptionQuery = Schema.Struct({
  limit: pageLimit,
  cursor: Schema.optionalKey(SubscriptionCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
  userId: Schema.optionalKey(UserId).annotateKey({
    description: "Only subscriptions of this user.",
  }),
  status: Schema.optionalKey(SubscriptionStatus).annotateKey({
    description: "Only subscriptions with this status.",
  }),
}).annotate({ identifier: "AdminSubscriptionQuery" });
export type AdminSubscriptionQuery = typeof AdminSubscriptionQuery.Type;

/** Body of `GET /admin/payments`: one page of payments. */
export const AdminPaymentPage = Schema.Struct({
  payments: Schema.Array(AdminPayment),
  /** The cursor of the next page; `null` on the last page. */
  nextCursor: Schema.NullOr(PaymentCursor),
}).annotate({
  identifier: "AdminPaymentPage",
  description:
    "One page of payments, newest first. `nextCursor` is the position " +
    "after the last returned payment, or null on the last page.",
});
export type AdminPaymentPage = typeof AdminPaymentPage.Type;

/** Body of `GET /admin/payments/subscriptions`: one page of subscriptions. */
export const AdminSubscriptionPage = Schema.Struct({
  subscriptions: Schema.Array(AdminSubscription),
  /** The cursor of the next page; `null` on the last page. */
  nextCursor: Schema.NullOr(SubscriptionCursor),
}).annotate({
  identifier: "AdminSubscriptionPage",
  description:
    "One page of subscriptions, newest first. `nextCursor` is the " +
    "position after the last returned subscription, or null on the last " +
    "page.",
});
export type AdminSubscriptionPage = typeof AdminSubscriptionPage.Type;

/** A price as admins see it: with whether it is active in Stripe. */
export const AdminPrice = Schema.Struct({
  ...Price.fields,
  active: Schema.Boolean,
}).annotate({
  identifier: "AdminPrice",
  description: "A price, including inactive ones.",
});
export type AdminPrice = typeof AdminPrice.Type;

/** A product as admins see it, mirrored from Stripe. */
export const AdminProduct = Schema.Struct({
  id: StripeProductId,
  name: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
  /** Active in Stripe. */
  active: Schema.Boolean,
  /** Offered on our site. */
  enabled: Schema.Boolean,
  kind: ProductKind,
  roles: Schema.Array(PurchasableRole),
  prices: Schema.Array(AdminPrice),
  livemode: Schema.Boolean,
  updatedAt: IsoDateTimeUtc,
}).annotate({
  identifier: "AdminProduct",
  description:
    "A product mirrored from Stripe. `active` is Stripe's flag, `enabled` " +
    "whether our site offers it.",
});
export type AdminProduct = typeof AdminProduct.Type;

/** Body of `PATCH /admin/payments/products/:productId`. */
export const UpdatePaymentProductPayload = Schema.Struct({
  enabled: Schema.Boolean,
  kind: ProductKind,
}).annotate({
  identifier: "UpdatePaymentProductPayload",
  description: "Whether the product is offered, and what kind it is.",
});
export type UpdatePaymentProductPayload =
  typeof UpdatePaymentProductPayload.Type;

/** Body of `PUT /admin/payments/products/:productId/roles`. */
export const SetPaymentProductRolesPayload = Schema.Struct({
  roles: Schema.Array(PurchasableRole).check(Schema.isUnique()),
}).annotate({
  identifier: "SetPaymentProductRolesPayload",
  description: "The roles the product grants, without duplicates.",
});
export type SetPaymentProductRolesPayload =
  typeof SetPaymentProductRolesPayload.Type;

/** Body of `POST /admin/payments/:paymentId/refund`. */
export const RefundPayload = Schema.Struct({
  /** In the payment's currency; absent = the whole remaining amount. */
  amount: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0)),
  ).annotateKey({
    description:
      "The amount to refund in the payment's minor unit; leave out to " +
      "refund the whole remaining amount.",
  }),
}).annotate({
  identifier: "RefundPayload",
  description: "How much to refund.",
});
export type RefundPayload = typeof RefundPayload.Type;

/** Body of `GET /admin/insights/payments`. One `PaymentMoney` per currency. */
export const PaymentInsights = Schema.Struct({
  revenueLast30Days: Schema.Array(PaymentMoney),
  revenueTotal: Schema.Array(PaymentMoney),
  refundedTotal: Schema.Array(PaymentMoney),
  monthlyRecurringRevenue: Schema.Array(PaymentMoney),
  activeSubscriptions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Whether the numbers are from Stripe's live mode (else test mode). */
  livemode: Schema.Boolean,
}).annotate({
  identifier: "PaymentInsights",
  description:
    "Revenue figures, one amount per currency. Revenue is amount minus " +
    "amount refunded of the payments that are paid, partially refunded or " +
    "disputed.",
});
export type PaymentInsights = typeof PaymentInsights.Type;
