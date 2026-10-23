import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import StripeSdk from "stripe";
import { PaymentsConfig, type PaymentsSettings } from "#Config";

/**
 * A call to Stripe failed. `reason` is a short code for logs and the outbox
 * (`last_error`): `unconfigured` (no secret key or webhook secret),
 * `api:<status>:<code>` (Stripe answered with an error), `transport`
 * (Stripe could not be reached). Never Stripe's message, which can quote
 * customer data.
 */
export class StripeFailed extends Schema.TaggedError<
  StripeFailed,
  { readonly brand: unique symbol }
>()("StripeFailed", { reason: Schema.String }) {
  override get message() {
    return `Stripe request failed (${this.reason})`;
  }
}

/** A webhook delivery whose `Stripe-Signature` does not match its body. */
export class StripeSignatureInvalid extends Schema.TaggedError<
  StripeSignatureInvalid,
  { readonly brand: unique symbol }
>()("StripeSignatureInvalid", {}) {}

// What the backend reads from Stripe, as plain records: the domain never
// sees the SDK's types. Times are Unix seconds, as Stripe sends them.

export interface StripePrice {
  readonly id: string;
  readonly productId: string;
  readonly active: boolean;
  readonly currency: string;
  /** None for prices without a fixed amount (tiered, pay what you want). */
  readonly unitAmount: Option.Option<number>;
  readonly recurring: Option.Option<{
    /** `day`, `week`, `month` or `year`. */
    readonly interval: string;
    readonly intervalCount: number;
  }>;
  readonly livemode: boolean;
}

export interface StripeProduct {
  readonly id: string;
  readonly name: string;
  readonly description: Option.Option<string>;
  readonly active: boolean;
  readonly livemode: boolean;
  /** Every price of the product, active or not. */
  readonly prices: ReadonlyArray<StripePrice>;
}

export interface StripeSubscription {
  readonly id: string;
  readonly customerId: string;
  /** Stripe's status, e.g. `active`, `past_due`. */
  readonly status: string;
  /** Of the first item; the site sells one product per subscription. */
  readonly productId: Option.Option<string>;
  readonly priceId: Option.Option<string>;
  readonly currentPeriodEnd: Option.Option<number>;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Option.Option<number>;
  readonly created: number;
  readonly livemode: boolean;
}

export interface StripeCheckoutSession {
  readonly id: string;
  /** `payment`, `subscription` or `setup`. */
  readonly mode: string;
  /** The product of the first line item; the site sells one per session. */
  readonly productId: Option.Option<string>;
  /** `open`, `complete` or `expired`. */
  readonly status: Option.Option<string>;
  /** `paid`, `unpaid` or `no_payment_required`. */
  readonly paymentStatus: string;
  readonly customerId: Option.Option<string>;
  readonly subscriptionId: Option.Option<string>;
  readonly paymentIntentId: Option.Option<string>;
  readonly amountTotal: Option.Option<number>;
  readonly currency: Option.Option<string>;
  readonly metadata: Readonly<Record<string, string>>;
  readonly created: number;
  readonly livemode: boolean;
}

export interface StripeInvoice {
  readonly id: string;
  /** `draft`, `open`, `paid`, `uncollectible` or `void`. */
  readonly status: Option.Option<string>;
  readonly customerId: Option.Option<string>;
  readonly subscriptionId: Option.Option<string>;
  /** Of the invoice's default payment, if it was paid with one. */
  readonly paymentIntentId: Option.Option<string>;
  readonly amountPaid: number;
  readonly currency: string;
  readonly created: number;
  readonly livemode: boolean;
}

export interface StripePaymentIntent {
  readonly id: string;
  /** `succeeded`, `processing`, `requires_payment_method`, `canceled`, … */
  readonly status: string;
  readonly amount: number;
  readonly amountReceived: number;
  /** Refunded so far, from the latest charge. */
  readonly amountRefunded: number;
  readonly currency: string;
  /** The status of the most recent dispute, if there was one. */
  readonly disputeStatus: Option.Option<string>;
  readonly created: number;
  readonly livemode: boolean;
}

/**
 * The ids a webhook event is about, taken from its (verified) object. The
 * backend never trusts the object itself: it fetches the current state by
 * these ids, so the order in which events arrive does not matter.
 */
export interface StripeEventRefs {
  readonly productId?: string;
  readonly checkoutSessionId?: string;
  readonly subscriptionId?: string;
  readonly invoiceId?: string;
  readonly paymentIntentId?: string;
}

export interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly livemode: boolean;
  readonly created: number;
  readonly refs: StripeEventRefs;
}

/** What a checkout charges: a price from the catalog, or an ad-hoc amount. */
export type StripeLineItem =
  | { readonly _tag: "Price"; readonly priceId: string }
  | {
      readonly _tag: "Amount";
      readonly productId: string;
      readonly currency: string;
      readonly unitAmount: number;
    };

export interface StripeCheckoutRequest {
  readonly customerId: string;
  readonly mode: "payment" | "subscription";
  readonly lineItem: StripeLineItem;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Our user id, also set as `client_reference_id`. */
  readonly userId: string;
  /** Copied onto the session and its payment intent or subscription. */
  readonly metadata: Readonly<Record<string, string>>;
}

const idOf = (value: unknown): Option.Option<string> =>
  typeof value === "string"
    ? Option.some(value)
    : typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string"
      ? Option.some(value.id)
      : Option.none();

// `{ key: value }` for Some, `{}` for None: Stripe's parameter types don't
// take an explicit undefined.
const present = <K extends string, A>(
  key: K,
  option: Option.Option<A>,
): { [P in K]?: A } =>
  Option.isSome(option) ? ({ [key]: option.value } as { [P in K]: A }) : {};

const reasonOf = (error: unknown): string =>
  error instanceof StripeSdk.errors.StripeConnectionError
    ? "transport"
    : error instanceof StripeSdk.errors.StripeError
      ? `api:${error.statusCode ?? "unknown"}:${error.code ?? error.type}`
      : "transport";

// A deleted or unknown object: the caller treats it as gone.
const isMissing = (error: unknown) =>
  error instanceof StripeSdk.errors.StripeError &&
  (error.code === "resource_missing" || error.statusCode === 404);

const refsOf = (object: unknown): StripeEventRefs => {
  if (typeof object !== "object" || object === null) return {};
  const record = object as Record<string, unknown>;
  const id = typeof record["id"] === "string" ? record["id"] : undefined;
  if (id === undefined) return {};
  switch (record["object"]) {
    case "product":
      return { productId: id };
    case "price":
      return Option.match(idOf(record["product"]), {
        onNone: () => ({}),
        onSome: (productId) => ({ productId }),
      });
    case "checkout.session":
      return { checkoutSessionId: id };
    case "subscription":
      return { subscriptionId: id };
    case "invoice":
      return { invoiceId: id };
    case "payment_intent":
      return { paymentIntentId: id };
    // Refunds and disputes are tracked on the payment intent they belong
    // to.
    case "charge":
    case "refund":
    case "dispute":
      return Option.match(idOf(record["payment_intent"]), {
        onNone: () => ({}),
        onSome: (paymentIntentId) => ({ paymentIntentId }),
      });
    default:
      return {};
  }
};

const priceOf = (price: StripeSdk.Price): StripePrice => ({
  id: price.id,
  productId: Option.getOrElse(idOf(price.product), () => ""),
  active: price.active,
  currency: price.currency,
  unitAmount: Option.fromNullishOr(price.unit_amount),
  recurring: Option.fromNullishOr(price.recurring).pipe(
    Option.map((recurring) => ({
      interval: recurring.interval,
      intervalCount: recurring.interval_count,
    })),
  ),
  livemode: price.livemode,
});

const subscriptionOf = (
  subscription: StripeSdk.Subscription,
): StripeSubscription => {
  const item = Option.fromNullishOr(subscription.items.data[0]);
  return {
    id: subscription.id,
    customerId: Option.getOrElse(idOf(subscription.customer), () => ""),
    status: subscription.status,
    productId: Option.flatMap(item, (it) => idOf(it.price.product)),
    priceId: Option.map(item, (it) => it.price.id),
    currentPeriodEnd: Option.map(item, (it) => it.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: Option.fromNullishOr(subscription.canceled_at),
    created: subscription.created,
    livemode: subscription.livemode,
  };
};

const make = (settings: PaymentsSettings) => {
  const client = Option.map(
    settings.secretKey,
    (key) =>
      new StripeSdk(Redacted.value(key), {
        // Stripe retries idempotent requests on network errors and 409/5xx.
        maxNetworkRetries: 2,
        timeout: 20_000,
        appInfo: { name: "unhalteproblem.de" },
      }),
  );
  const livemode = Option.match(settings.secretKey, {
    onNone: () => false,
    onSome: (key) => Redacted.value(key).includes("_live_"),
  });
  const configured =
    Option.isSome(client) && Option.isSome(settings.webhookSecret);

  const call = <A>(
    span: string,
    run: (stripe: StripeSdk) => Promise<A>,
  ): Effect.Effect<A, StripeFailed> =>
    Option.match(client, {
      onNone: () => Effect.fail(new StripeFailed({ reason: "unconfigured" })),
      onSome: (stripe) =>
        Effect.tryPromise({
          try: () => run(stripe),
          catch: (error) => new StripeFailed({ reason: reasonOf(error) }),
        }),
    }).pipe(Effect.withSpan(`Stripe.${span}`));

  // A read of one object: None when Stripe has no such object (any more).
  const find = <A>(
    span: string,
    run: (stripe: StripeSdk) => Promise<A>,
  ): Effect.Effect<Option.Option<A>, StripeFailed> =>
    Option.match(client, {
      onNone: () => Effect.fail(new StripeFailed({ reason: "unconfigured" })),
      onSome: (stripe) =>
        Effect.tryPromise({
          try: () =>
            run(stripe).then(
              (value) => Option.some(value),
              (error: unknown) => {
                if (isMissing(error)) return Option.none<A>();
                throw error;
              },
            ),
          catch: (error) => new StripeFailed({ reason: reasonOf(error) }),
        }),
    }).pipe(Effect.withSpan(`Stripe.${span}`));

  const checkoutParams = (
    request: StripeCheckoutRequest,
  ): StripeSdk.Checkout.SessionCreateParams => {
    const metadata = { ...request.metadata };
    const params: StripeSdk.Checkout.SessionCreateParams = {
      customer: request.customerId,
      mode: request.mode,
      line_items: [
        request.lineItem._tag === "Price"
          ? { price: request.lineItem.priceId, quantity: 1 }
          : {
              price_data: {
                currency: request.lineItem.currency,
                product: request.lineItem.productId,
                unit_amount: request.lineItem.unitAmount,
              },
              quantity: 1,
            },
      ],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.userId,
      metadata,
    };
    if (request.mode === "subscription") {
      params.subscription_data = { metadata };
    } else {
      params.payment_intent_data = { metadata };
      params.submit_type = "pay";
      if (settings.checkoutInvoices) {
        params.invoice_creation = {
          enabled: true,
          invoice_data: present("footer", settings.invoiceFooter),
        };
      }
    }
    if (settings.automaticTax) {
      params.automatic_tax = { enabled: true };
      // Stripe Tax needs the buyer's address, kept on the customer.
      params.customer_update = { address: "auto", name: "auto" };
      params.billing_address_collection = "required";
    }
    return params;
  };

  const pricesOf = (stripe: StripeSdk, productId: string) =>
    stripe.prices
      .list({ product: productId, limit: 100 })
      .autoPagingToArray({ limit: 1000 });

  const productOf = async (
    stripe: StripeSdk,
    product: StripeSdk.Product,
  ): Promise<StripeProduct> => ({
    id: product.id,
    name: product.name,
    description: Option.fromNullishOr(product.description),
    active: product.active,
    livemode: product.livemode,
    prices: (await pricesOf(stripe, product.id)).map(priceOf),
  });

  return Stripe.of({
    configured,
    livemode,

    createCustomer: ({ userId, email, name }) =>
      call("createCustomer", (stripe) =>
        stripe.customers.create(
          {
            ...present("email", email),
            ...present("name", name),
            metadata: { userId },
          },
          // Two checkouts started at once make one customer.
          { idempotencyKey: `customer-${userId}` },
        ),
      ).pipe(Effect.map((customer) => customer.id)),

    createCheckoutSession: (request) =>
      call("createCheckoutSession", (stripe) =>
        stripe.checkout.sessions.create(checkoutParams(request)),
      ).pipe(
        Effect.flatMap((session) =>
          session.url === null
            ? Effect.fail(new StripeFailed({ reason: "checkout:no-url" }))
            : Effect.succeed({ id: session.id, url: session.url }),
        ),
      ),

    createPortalSession: ({ customerId, returnUrl }) =>
      call("createPortalSession", (stripe) =>
        stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
        }),
      ).pipe(Effect.map((session) => session.url)),

    product: (id) =>
      find("product", (stripe) =>
        stripe.products
          .retrieve(id)
          .then((product) => productOf(stripe, product)),
      ),

    products: call("products", async (stripe) => {
      const products = await stripe.products
        .list({ limit: 100 })
        .autoPagingToArray({ limit: 1000 });
      return Promise.all(products.map((product) => productOf(stripe, product)));
    }),

    subscription: (id) =>
      find("subscription", (stripe) =>
        stripe.subscriptions
          .retrieve(id, { expand: ["items.data.price"] })
          .then(subscriptionOf),
      ),

    subscriptionsOfCustomer: (customerId) =>
      call("subscriptionsOfCustomer", (stripe) =>
        stripe.subscriptions
          .list({ customer: customerId, status: "all", limit: 100 })
          .autoPagingToArray({ limit: 1000 }),
      ).pipe(Effect.map((list) => list.map(subscriptionOf))),

    cancelSubscription: (id) =>
      // One that is gone counts as canceled (`find` answers None).
      find("cancelSubscription", (stripe) =>
        stripe.subscriptions.cancel(id, { prorate: false }),
      ).pipe(Effect.asVoid),

    checkoutSession: (id) =>
      find("checkoutSession", (stripe) =>
        stripe.checkout.sessions
          .retrieve(id, { expand: ["line_items"] })
          .then((session): StripeCheckoutSession => ({
            id: session.id,
            mode: session.mode,
            productId: Option.fromNullishOr(
              session.line_items?.data[0]?.price,
            ).pipe(Option.flatMap((price) => idOf(price.product))),
            status: Option.fromNullishOr(session.status),
            paymentStatus: session.payment_status,
            customerId: idOf(session.customer),
            subscriptionId: idOf(session.subscription),
            paymentIntentId: idOf(session.payment_intent),
            amountTotal: Option.fromNullishOr(session.amount_total),
            currency: Option.fromNullishOr(session.currency),
            metadata: session.metadata ?? {},
            created: session.created,
            livemode: session.livemode,
          })),
      ),

    invoice: (id) =>
      find("invoice", (stripe) =>
        stripe.invoices
          .retrieve(id, { expand: ["payments"] })
          .then((invoice): StripeInvoice => {
            const payment = (invoice.payments?.data ?? []).find(
              (entry) => entry.is_default,
            );
            return {
              id: invoice.id ?? id,
              status: Option.fromNullishOr(invoice.status),
              customerId: idOf(invoice.customer),
              subscriptionId: Option.fromNullishOr(
                invoice.parent?.subscription_details,
              ).pipe(Option.flatMap((details) => idOf(details.subscription))),
              paymentIntentId: Option.fromNullishOr(payment).pipe(
                Option.flatMap((entry) => idOf(entry.payment.payment_intent)),
              ),
              amountPaid: invoice.amount_paid,
              currency: invoice.currency,
              created: invoice.created,
              livemode: invoice.livemode,
            };
          }),
      ),

    paymentIntent: (id) =>
      find("paymentIntent", async (stripe) => {
        const intent = await stripe.paymentIntents.retrieve(id, {
          expand: ["latest_charge"],
        });
        const disputes = await stripe.disputes.list({
          payment_intent: id,
          limit: 1,
        });
        const charge = intent.latest_charge;
        return {
          id: intent.id,
          status: intent.status,
          amount: intent.amount,
          amountReceived: intent.amount_received,
          amountRefunded:
            typeof charge === "object" && charge !== null
              ? charge.amount_refunded
              : 0,
          currency: intent.currency,
          disputeStatus: Option.fromNullishOr(disputes.data[0]?.status),
          created: intent.created,
          livemode: intent.livemode,
        } satisfies StripePaymentIntent;
      }),

    refund: ({ paymentIntentId, amount, idempotencyKey }) =>
      call("refund", (stripe) =>
        stripe.refunds.create(
          { payment_intent: paymentIntentId, ...present("amount", amount) },
          { idempotencyKey },
        ),
      ).pipe(Effect.asVoid),

    verifyWebhook: (payload, signature) =>
      Option.match<
        readonly [StripeSdk, Redacted.Redacted],
        Effect.Effect<StripeEvent, StripeFailed | StripeSignatureInvalid>,
        Effect.Effect<StripeEvent, StripeFailed | StripeSignatureInvalid>
      >(Option.all([client, settings.webhookSecret]), {
        onNone: () => Effect.fail(new StripeFailed({ reason: "unconfigured" })),
        onSome: ([stripe, secret]) =>
          Effect.tryPromise({
            // The default tolerance (5 minutes) rejects replayed deliveries.
            try: () =>
              stripe.webhooks.constructEventAsync(
                payload,
                signature,
                Redacted.value(secret),
              ),
            catch: () => new StripeSignatureInvalid(),
          }).pipe(
            Effect.map((event): StripeEvent => ({
              id: event.id,
              type: event.type,
              livemode: event.livemode,
              created: event.created,
              refs: refsOf(event.data.object),
            })),
          ),
      }).pipe(Effect.withSpan("Stripe.verifyWebhook")),
  });
};

/**
 * Stripe, the payment provider: hosted Checkout and the customer portal,
 * the catalog (products and prices made in the Stripe dashboard), and the
 * current state of subscriptions, invoices and payments, which the
 * payments domain mirrors after every webhook.
 *
 * Without `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` the service still
 * exists, `configured` is false and every call fails with
 * `StripeFailed("unconfigured")`, so the rest of the backend runs without
 * them.
 */
export class Stripe extends Context.Service<
  Stripe,
  {
    /** Whether a secret key and a webhook secret are set. */
    readonly configured: boolean;
    /** Whether the key is a live key (else test mode, or none). */
    readonly livemode: boolean;
    readonly createCustomer: (customer: {
      readonly userId: string;
      readonly email: Option.Option<string>;
      readonly name: Option.Option<string>;
    }) => Effect.Effect<string, StripeFailed>;
    readonly createCheckoutSession: (
      request: StripeCheckoutRequest,
    ) => Effect.Effect<
      { readonly id: string; readonly url: string },
      StripeFailed
    >;
    readonly createPortalSession: (session: {
      readonly customerId: string;
      readonly returnUrl: string;
    }) => Effect.Effect<string, StripeFailed>;
    readonly product: (
      id: string,
    ) => Effect.Effect<Option.Option<StripeProduct>, StripeFailed>;
    /** The whole catalog, active and archived products. */
    readonly products: Effect.Effect<
      ReadonlyArray<StripeProduct>,
      StripeFailed
    >;
    readonly subscription: (
      id: string,
    ) => Effect.Effect<Option.Option<StripeSubscription>, StripeFailed>;
    readonly subscriptionsOfCustomer: (
      customerId: string,
    ) => Effect.Effect<ReadonlyArray<StripeSubscription>, StripeFailed>;
    /** Cancels now, without proration; one Stripe no longer has is done. */
    readonly cancelSubscription: (
      id: string,
    ) => Effect.Effect<void, StripeFailed>;
    readonly checkoutSession: (
      id: string,
    ) => Effect.Effect<Option.Option<StripeCheckoutSession>, StripeFailed>;
    readonly invoice: (
      id: string,
    ) => Effect.Effect<Option.Option<StripeInvoice>, StripeFailed>;
    readonly paymentIntent: (
      id: string,
    ) => Effect.Effect<Option.Option<StripePaymentIntent>, StripeFailed>;
    /** Refunds `amount` (None: all that is left) of a payment intent. */
    readonly refund: (refund: {
      readonly paymentIntentId: string;
      readonly amount: Option.Option<number>;
      readonly idempotencyKey: string;
    }) => Effect.Effect<void, StripeFailed>;
    /**
     * Checks a webhook delivery's signature (and its age) against the raw
     * body and returns the event; `StripeSignatureInvalid` otherwise.
     */
    readonly verifyWebhook: (
      payload: string,
      signature: string,
    ) => Effect.Effect<StripeEvent, StripeFailed | StripeSignatureInvalid>;
  }
>()("@unhalteproblem.de/backend/Stripe") {
  /** For tests and special setups. */
  static readonly layerWith = (settings: PaymentsSettings) =>
    Layer.succeed(Stripe, make(settings));

  /** From `PaymentsConfig` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, …). */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      return Stripe.layerWith(yield* PaymentsConfig);
    }),
  );
}
