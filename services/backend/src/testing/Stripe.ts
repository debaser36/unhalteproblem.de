import { Effect, Layer, Option, Redacted } from "effect";
import StripeSdk from "stripe";
import {
  Stripe,
  type StripeCheckoutRequest,
  type StripeCheckoutSession,
  StripeFailed,
  type StripeInvoice,
  type StripePaymentIntent,
  type StripeProduct,
  type StripeSubscription,
} from "#infrastructure/Stripe";

/**
 * A Stripe that lives in memory, for tests: what the backend would fetch
 * is whatever the test puts into `state`, and what it would send (new
 * customers, checkouts, refunds, cancellations) is recorded there. Webhook
 * signatures are checked by the real code with `webhookSecret`, and
 * `signed` makes a delivery that passes. Test support only.
 */

export const webhookSecret = "whsec_test_secret";
const secretKey = "sk_test_fake";

export interface FakeStripeState {
  readonly products: Map<string, StripeProduct>;
  readonly subscriptions: Map<string, StripeSubscription>;
  readonly checkoutSessions: Map<string, StripeCheckoutSession>;
  readonly invoices: Map<string, StripeInvoice>;
  readonly paymentIntents: Map<string, StripePaymentIntent>;
  /** Customers made, in order. */
  readonly customers: Array<{ readonly id: string; readonly userId: string }>;
  readonly checkouts: Array<StripeCheckoutRequest>;
  readonly portals: Array<string>;
  readonly refunds: Array<{
    readonly paymentIntentId: string;
    readonly amount: Option.Option<number>;
    readonly idempotencyKey: string;
  }>;
  readonly canceled: Array<string>;
  /** When set, every call fails with this reason. */
  failWith: Option.Option<string>;
}

export const makeFakeStripe = (
  options: { readonly configured?: boolean; readonly livemode?: boolean } = {},
) => {
  const configured = options.configured ?? true;
  const livemode = options.livemode ?? false;
  const state: FakeStripeState = {
    products: new Map(),
    subscriptions: new Map(),
    checkoutSessions: new Map(),
    invoices: new Map(),
    paymentIntents: new Map(),
    customers: [],
    checkouts: [],
    portals: [],
    refunds: [],
    canceled: [],
    failWith: Option.none(),
  };

  // The real verification, which needs no network.
  const real = Effect.runSync(
    Stripe.pipe(
      Effect.provide(
        Stripe.layerWith({
          secretKey: Option.some(Redacted.make(secretKey)),
          webhookSecret: Option.some(Redacted.make(webhookSecret)),
          automaticTax: false,
          checkoutInvoices: false,
          invoiceFooter: Option.none(),
          tipCurrency: "eur",
          tipMinimum: 100,
          tipMaximum: 50_000,
        }),
      ),
    ),
  );

  const guarded = <A>(run: () => A): Effect.Effect<A, StripeFailed> =>
    Effect.suspend(() =>
      !configured
        ? Effect.fail(new StripeFailed({ reason: "unconfigured" }))
        : Option.isSome(state.failWith)
          ? Effect.fail(new StripeFailed({ reason: state.failWith.value }))
          : Effect.sync(run),
    );

  const layer = Layer.succeed(
    Stripe,
    Stripe.of({
      configured,
      livemode,
      createCustomer: ({ userId }) =>
        guarded(() => {
          const existing = state.customers.find((c) => c.userId === userId);
          if (existing !== undefined) return existing.id;
          const id = `cus_${state.customers.length + 1}`;
          state.customers.push({ id, userId });
          return id;
        }),
      createCheckoutSession: (request) =>
        guarded(() => {
          state.checkouts.push(request);
          const id = `cs_test_${state.checkouts.length}`;
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        }),
      createPortalSession: ({ customerId }) =>
        guarded(() => {
          state.portals.push(customerId);
          return `https://billing.stripe.com/p/session/${customerId}`;
        }),
      product: (id) =>
        guarded(() => Option.fromNullishOr(state.products.get(id))),
      products: guarded(() => [...state.products.values()]),
      subscription: (id) =>
        guarded(() => Option.fromNullishOr(state.subscriptions.get(id))),
      subscriptionsOfCustomer: (customerId) =>
        guarded(() =>
          [...state.subscriptions.values()].filter(
            (subscription) => subscription.customerId === customerId,
          ),
        ),
      cancelSubscription: (id) =>
        guarded(() => {
          state.canceled.push(id);
          const subscription = state.subscriptions.get(id);
          if (subscription !== undefined) {
            state.subscriptions.set(id, {
              ...subscription,
              status: "canceled",
            });
          }
        }),
      checkoutSession: (id) =>
        guarded(() => Option.fromNullishOr(state.checkoutSessions.get(id))),
      invoice: (id) =>
        guarded(() => Option.fromNullishOr(state.invoices.get(id))),
      paymentIntent: (id) =>
        guarded(() => Option.fromNullishOr(state.paymentIntents.get(id))),
      refund: (refund) =>
        guarded(() => {
          state.refunds.push(refund);
          const intent = state.paymentIntents.get(refund.paymentIntentId);
          if (intent !== undefined) {
            state.paymentIntents.set(intent.id, {
              ...intent,
              amountRefunded: Option.match(refund.amount, {
                onNone: () => intent.amountReceived,
                onSome: (amount) => intent.amountRefunded + amount,
              }),
            });
          }
        }),
      verifyWebhook: (payload, signature) =>
        configured
          ? real.verifyWebhook(payload, signature)
          : Effect.fail(new StripeFailed({ reason: "unconfigured" })),
    }),
  );

  return { state, layer };
};

/**
 * A webhook delivery as Stripe sends it: the event as JSON and a valid
 * `Stripe-Signature` for it (signed now).
 */
export const signed = (event: {
  readonly id: string;
  readonly type: string;
  readonly object: Record<string, unknown>;
  readonly livemode?: boolean;
}) => {
  const payload = JSON.stringify({
    id: event.id,
    object: "event",
    type: event.type,
    livemode: event.livemode ?? false,
    created: Math.floor(Date.now() / 1000),
    api_version: "2026-09-30.endive",
    data: { object: event.object },
  });
  const signature = new StripeSdk(secretKey).webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  return { payload, signature };
};

/** A product with prices, as `Stripe.product` returns it. */
export const product = (
  id: string,
  prices: ReadonlyArray<{
    readonly id: string;
    readonly amount: number;
    readonly interval?: "day" | "week" | "month" | "year";
    readonly active?: boolean;
  }>,
  overrides: Partial<Omit<StripeProduct, "prices">> = {},
): StripeProduct => ({
  id,
  name: `Product ${id}`,
  description: Option.none(),
  active: true,
  livemode: false,
  ...overrides,
  prices: prices.map((price) => ({
    id: price.id,
    productId: id,
    active: price.active ?? true,
    currency: "eur",
    unitAmount: Option.some(price.amount),
    recurring:
      price.interval === undefined
        ? Option.none()
        : Option.some({ interval: price.interval, intervalCount: 1 }),
    livemode: false,
  })),
});
