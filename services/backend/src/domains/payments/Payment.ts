import {
  type PaymentKind,
  type PaymentMoney,
  type PaymentStatus,
  type PurchasableRole,
  PurchasableRole as PurchasableRoleSchema,
  type RecurringInterval,
  type SubscriptionStatus,
} from "@unhalteproblem.de/api";
import { Array as Arr, DateTime, Option, Schema } from "effect";
import type { StripePaymentIntent } from "#infrastructure/Stripe";

/**
 * Payments through Stripe: the rules, as pure functions. Stripe is the
 * source of truth for every payment and subscription; the backend mirrors
 * the current state after each webhook and derives from it which roles a
 * user holds because they paid (`entitledRoles`).
 */

/** Stripe's subscription statuses, in the contract's spelling. */
const subscriptionStatuses: Readonly<Record<string, SubscriptionStatus>> = {
  incomplete: "incomplete",
  incomplete_expired: "incompleteExpired",
  trialing: "trialing",
  active: "active",
  past_due: "pastDue",
  canceled: "canceled",
  unpaid: "unpaid",
  paused: "paused",
};

/**
 * Our spelling of a Stripe subscription status. A status Stripe adds later
 * counts as `incomplete`: it grants nothing until we know what it means.
 */
export const subscriptionStatusOf = (status: string): SubscriptionStatus =>
  subscriptionStatuses[status] ?? "incomplete";

/**
 * Whether a subscription in this status grants its roles. Only a paid-up
 * one does: the first failed payment (`pastDue`) already takes the roles
 * away, and they come back when a retry or a new card succeeds.
 */
export const subscriptionGrantsAccess = (status: SubscriptionStatus) =>
  status === "active" || status === "trialing";

/**
 * Whether a subscription in this status is still alive, so that its
 * subscriber manages it in the portal instead of starting a second one.
 */
export const subscriptionIsLive = (status: SubscriptionStatus) =>
  status !== "canceled" && status !== "incompleteExpired";

// Disputes Stripe still decides about; `won`, `warning_closed` and
// `prevented` end in the merchant's favour.
const openDisputes = new Set([
  "warning_needs_response",
  "needs_response",
  "under_review",
  "warning_under_review",
]);

/** The status of a payment, from the current state of its payment intent. */
export const paymentStatusOf = (intent: StripePaymentIntent): PaymentStatus => {
  if (Option.contains(intent.disputeStatus, "lost")) return "disputeLost";
  if (
    Option.isSome(intent.disputeStatus) &&
    openDisputes.has(intent.disputeStatus.value)
  ) {
    return "disputed";
  }
  switch (intent.status) {
    case "succeeded":
      if (intent.amountRefunded <= 0) return "paid";
      return intent.amountRefunded >= intent.amountReceived
        ? "refunded"
        : "partiallyRefunded";
    // Asynchronous methods (SEPA Direct Debit, bank transfers) take days.
    case "processing":
    case "requires_action":
    case "requires_confirmation":
    case "requires_capture":
      return "pending";
    default:
      return "failed";
  }
};

/**
 * Whether a one-off purchase in this status grants its roles: paid, also
 * partly refunded, and while a dispute is open. A full refund and a lost
 * dispute take them away; a pending one (a direct debit on its way) grants
 * them once it is paid.
 */
export const purchaseGrantsAccess = (status: PaymentStatus) =>
  status === "paid" || status === "partiallyRefunded" || status === "disputed";

/** Whether a purchase in this status stops the buyer from buying again. */
export const purchaseBlocksRepeat = (status: PaymentStatus) =>
  purchaseGrantsAccess(status) || status === "pending";

const isPurchasableRole = Schema.is(PurchasableRoleSchema);

/**
 * The roles a user holds because they paid: those of every product they
 * subscribe to (while the subscription grants access) or bought once
 * (while the purchase does). Tips and subscription invoices grant nothing
 * of their own. Sorted, without duplicates; a role that is not purchasable
 * (should the mapping ever contain one) is left out.
 */
export const entitledRoles = (input: {
  readonly subscriptions: ReadonlyArray<{
    readonly status: SubscriptionStatus;
    readonly productId: Option.Option<string>;
  }>;
  readonly payments: ReadonlyArray<{
    readonly kind: PaymentKind;
    readonly status: PaymentStatus;
    readonly productId: Option.Option<string>;
  }>;
  readonly rolesOf: (productId: string) => ReadonlyArray<string>;
}): ReadonlyArray<PurchasableRole> => {
  const products = [
    ...input.subscriptions
      .filter((subscription) => subscriptionGrantsAccess(subscription.status))
      .map((subscription) => subscription.productId),
    ...input.payments
      .filter(
        (payment) =>
          payment.kind === "purchase" && purchaseGrantsAccess(payment.status),
      )
      .map((payment) => payment.productId),
  ];
  const roles = Arr.getSomes(products)
    .flatMap(input.rolesOf)
    .filter(isPurchasableRole);
  return Arr.dedupe(roles).sort();
};

/**
 * Why `requested` (None: everything left) of a payment can't be refunded,
 * if it can't: only paid money comes back, and never more than is left.
 */
export const refundRefusal = (
  payment: {
    readonly status: PaymentStatus;
    readonly amount: number;
    readonly amountRefunded: number;
  },
  requested: Option.Option<number>,
): Option.Option<"notPaid" | "exceedsRemaining"> => {
  const remaining = payment.amount - payment.amountRefunded;
  if (
    (payment.status !== "paid" && payment.status !== "partiallyRefunded") ||
    remaining <= 0
  ) {
    return Option.some("notPaid");
  }
  if (Option.isSome(requested) && requested.value > remaining) {
    return Option.some("exceedsRemaining");
  }
  return Option.none();
};

// Average lengths, so that a yearly price counts a twelfth per month.
const perMonth: Record<RecurringInterval, number> = {
  day: 365 / 12,
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

/**
 * What a recurring price brings in per month, in the currency's minor
 * unit (not rounded; round the sum).
 */
export const monthlyAmount = (
  amount: number,
  interval: RecurringInterval,
  intervalCount: number,
): number => (amount * perMonth[interval]) / intervalCount;

/** Sums amounts per currency, sorted by currency, rounding each sum. */
export const sumByCurrency = (
  amounts: ReadonlyArray<{
    readonly amount: number;
    readonly currency: string;
  }>,
): ReadonlyArray<PaymentMoney> => {
  const sums = new Map<string, number>();
  for (const { amount, currency } of amounts) {
    sums.set(currency, (sums.get(currency) ?? 0) + amount);
  }
  return Array.from(sums, ([currency, amount]) => ({
    currency,
    amount: Math.round(amount),
  })).sort((a, b) => a.currency.localeCompare(b.currency));
};

/** A Stripe timestamp (Unix seconds). */
export const fromStripeTime = (seconds: number): DateTime.Utc =>
  DateTime.makeUnsafe(seconds * 1000);

/**
 * What a checkout session carries in its metadata, so that the payment it
 * leads to can be told apart (a purchase or a tip) and tied to a product.
 * Our user is taken from the Stripe customer, never from here.
 */
export const CheckoutMetadata = Schema.Struct({
  kind: Schema.Literals(["purchase", "tip", "subscription"]),
  productId: Schema.String,
});
export type CheckoutMetadata = typeof CheckoutMetadata.Type;
