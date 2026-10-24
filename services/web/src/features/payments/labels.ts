import type {
  CreditFeature,
  PaymentStatus,
  SubscriptionStatus,
} from "@unhalteproblem.de/api";
import type { BadgeTone } from "#ui/Badge.tsx";

/** What a role unlocks, for buyers. */
export const roleLabels: Record<string, string> = {
  foodPlanner: "Food planner",
  mealPlanBuyer: "Meal plans (with credits)",
};

/** A feature that credits are bought for: one use, and several. */
export const featureLabels: Record<
  CreditFeature,
  { readonly one: string; readonly many: string }
> = {
  mealPlan: { one: "meal plan", many: "meal plans" },
};

/** `3 meal plans`, `1 meal plan` */
export const creditLabel = (feature: CreditFeature, quantity: number) =>
  `${quantity} ${quantity === 1 ? featureLabels[feature].one : featureLabels[feature].many}`;

export const subscriptionTone: Record<SubscriptionStatus, BadgeTone> = {
  active: "accent",
  trialing: "info",
  pastDue: "danger",
  unpaid: "danger",
  incomplete: "warning",
  incompleteExpired: "neutral",
  paused: "warning",
  canceled: "neutral",
};

export const paymentTone: Record<PaymentStatus, BadgeTone> = {
  paid: "accent",
  pending: "info",
  failed: "danger",
  partiallyRefunded: "warning",
  refunded: "neutral",
  disputed: "warning",
  disputeLost: "danger",
};

/** `pastDue` → `past due` */
export const statusLabel = (status: string): string =>
  status.replace(/([A-Z])/gu, " $1").toLowerCase();

/** Stripe's dashboard, in the mode the record was made in. */
export const dashboardUrl = (livemode: boolean, path: string) =>
  `https://dashboard.stripe.com/${livemode ? "" : "test/"}${path}`;
