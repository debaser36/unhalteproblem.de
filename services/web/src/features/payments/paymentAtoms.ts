import type {
  PaymentCursor,
  PaymentStatus,
  SubscriptionCursor,
  SubscriptionStatus,
  UserId,
} from "@unhalteproblem.de/api";
import { ApiClient } from "#api/ApiClient.ts";
import { sessionKey } from "#api/session.ts";

// The roles a payment grants arrive with Stripe's webhook, so whatever
// shows payments also depends on the session (the user's roles).
export const catalogKey = "payments/catalog";
export const myPaymentsKey = "payments/mine";
export const adminPaymentsKey = "admin/payments";
export const adminProductsKey = "admin/payments/products";

export const catalogAtom = ApiClient.query("paymentCatalog", "getCatalog", {
  reactivityKeys: [catalogKey],
});

export const myPaymentsAtom = ApiClient.query("payments", "myPayments", {
  reactivityKeys: [myPaymentsKey, sessionKey],
});

export const startCheckout = ApiClient.mutation("payments", "startCheckout");
export const openBillingPortal = ApiClient.mutation(
  "payments",
  "openBillingPortal",
);

// Admin

const pageQuery = <Cursor, Status>(filter: {
  readonly cursor: Cursor | undefined;
  readonly userId: UserId | undefined;
  readonly status: Status | undefined;
}) => ({
  limit: 50,
  ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }),
  ...(filter.userId === undefined ? {} : { userId: filter.userId }),
  ...(filter.status === undefined ? {} : { status: filter.status }),
});

export const adminPaymentsAtom = (filter: {
  readonly cursor: PaymentCursor | undefined;
  readonly userId: UserId | undefined;
  readonly status: PaymentStatus | undefined;
}) =>
  ApiClient.query("paymentAdmin", "listPayments", {
    query: pageQuery(filter),
    reactivityKeys: [adminPaymentsKey],
  });

export const adminSubscriptionsAtom = (filter: {
  readonly cursor: SubscriptionCursor | undefined;
  readonly userId: UserId | undefined;
  readonly status: SubscriptionStatus | undefined;
}) =>
  ApiClient.query("paymentAdmin", "listSubscriptions", {
    query: pageQuery(filter),
    reactivityKeys: [adminPaymentsKey],
  });

export const adminProductsAtom = ApiClient.query(
  "paymentAdmin",
  "listPaymentProducts",
  { reactivityKeys: [adminProductsKey] },
);

export const paymentInsightsAtom = ApiClient.query(
  "adminInsights",
  "paymentInsights",
  { reactivityKeys: [adminPaymentsKey] },
);

export const refundPayment = ApiClient.mutation(
  "paymentAdmin",
  "refundPayment",
);
export const syncPaymentProducts = ApiClient.mutation(
  "paymentAdmin",
  "syncPaymentProducts",
);
export const updatePaymentProduct = ApiClient.mutation(
  "paymentAdmin",
  "updatePaymentProduct",
);
export const setPaymentProductRoles = ApiClient.mutation(
  "paymentAdmin",
  "setPaymentProductRoles",
);
export const setPaymentProductCredits = ApiClient.mutation(
  "paymentAdmin",
  "setPaymentProductCredits",
);
