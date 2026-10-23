import {
  type AdminPayment,
  type AdminPaymentPage,
  type AdminProduct,
  type AdminSubscription,
  type AdminSubscriptionPage,
  Authorized,
  type Catalog,
  type MyPayments,
  type Payment,
  type PaymentCursorPosition,
  type PaymentId,
  type PaymentInsights,
  type PaymentStatus,
  type Price,
  type ProductRef,
  type Subscription,
  type SubscriptionCursorPosition,
  type SubscriptionStatus,
} from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import {
  Array as Arr,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
} from "effect";
import { PaymentsConfig } from "#Config";
import * as Query from "#cqrs/Query";
import { UserDirectory } from "#domains/users/UserDirectory";
import type { UserId } from "#domains/users/User";
import { Stripe } from "#infrastructure/Stripe";
import { monthlyAmount, sumByCurrency } from "./Payment.ts";
import {
  PaymentRepository,
  type PaymentRow,
  type PriceRow,
  type ProductRow,
  type SubscriptionRow,
} from "./PaymentRepository.ts";

/** A price the site can sell: active, in the current mode, with a fixed amount. */
const sellable = (price: PriceRow, livemode: boolean) =>
  price.active &&
  price.livemode === livemode &&
  Option.isSome(price.unitAmount);

const priceView = (price: PriceRow): Price => ({
  id: price.id,
  amount: {
    amount: Option.getOrElse(price.unitAmount, () => 0),
    currency: price.currency,
  },
  recurring: Option.zipWith(
    price.recurringInterval,
    price.recurringIntervalCount,
    (interval, intervalCount) => ({ interval, intervalCount }),
  ),
});

const make = Effect.gen(function* () {
  const repository = yield* PaymentRepository;
  const stripe = yield* Stripe;
  const users = yield* UserDirectory;
  const settings = yield* PaymentsConfig;
  const livemode = stripe.livemode;

  // Names and prices of the products these rows refer to.
  const catalogOf = Effect.fnUntraced(function* (
    productIds: ReadonlyArray<string>,
  ) {
    const ids = [...new Set(productIds)];
    const products = new Map<string, ProductRow>();
    for (const id of ids) {
      const product = yield* repository.findProduct(id);
      if (Option.isSome(product)) products.set(id, product.value);
    }
    const prices = new Map(
      (yield* repository.pricesOf(ids)).map((price) => [price.id, price]),
    );
    return {
      ref: (id: Option.Option<string>): Option.Option<ProductRef> =>
        Option.flatMap(id, (productId) =>
          Option.fromNullishOr(products.get(productId)).pipe(
            Option.map((product) => ({ id: product.id, name: product.name })),
          ),
        ),
      price: (id: Option.Option<string>): Option.Option<Price> =>
        Option.flatMap(id, (priceId) =>
          Option.fromNullishOr(prices.get(priceId)).pipe(Option.map(priceView)),
        ),
    };
  });

  const subscriptionsView = Effect.fnUntraced(function* (
    rows: ReadonlyArray<SubscriptionRow>,
  ) {
    const catalog = yield* catalogOf(
      Arr.getSomes(rows.map((row) => row.productId)),
    );
    return rows.map((row): AdminSubscription => ({
      id: row.id,
      product: catalog.ref(row.productId),
      status: row.status,
      price: catalog.price(row.priceId),
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt,
      userId: row.userId,
      livemode: row.livemode,
    }));
  });

  const paymentsView = Effect.fnUntraced(function* (
    rows: ReadonlyArray<PaymentRow>,
  ) {
    const catalog = yield* catalogOf(
      Arr.getSomes(rows.map((row) => row.productId)),
    );
    return rows.map((row): AdminPayment => ({
      id: row.id,
      kind: row.kind,
      product: catalog.ref(row.productId),
      amount: { amount: row.amount, currency: row.currency },
      amountRefunded: row.amountRefunded,
      status: row.status,
      createdAt: row.createdAt,
      userId: row.userId,
      stripePaymentIntentId: row.paymentIntentId,
      livemode: row.livemode,
    }));
  });

  // What a buyer sees of their own: no user id or Stripe references.
  const ownSubscription = ({
    userId: _userId,
    livemode: _livemode,
    ...subscription
  }: AdminSubscription): Subscription => subscription;
  const ownPayment = ({
    userId: _userId,
    stripePaymentIntentId: _intent,
    livemode: _livemode,
    ...payment
  }: AdminPayment): Payment => payment;

  const productsView = Effect.fnUntraced(function* (
    rows: ReadonlyArray<ProductRow>,
  ) {
    const ids = rows.map((row) => row.id);
    const prices = yield* repository.pricesOf(ids);
    const roles = yield* repository.rolesOf(ids);
    return rows.map((row): AdminProduct => ({
      id: row.id,
      name: row.name,
      description: row.description,
      active: row.active,
      enabled: row.enabled,
      kind: row.kind,
      roles: roles.get(row.id) ?? [],
      prices: prices
        .filter(
          (price) =>
            price.productId === row.id && Option.isSome(price.unitAmount),
        )
        .map((price) => ({ ...priceView(price), active: price.active })),
      livemode: row.livemode,
      updatedAt: row.updatedAt,
    }));
  });

  const page = <
    Row extends { readonly createdAt: DateTime.Utc; readonly id: string },
  >(
    rows: ReadonlyArray<Row>,
    limit: number,
  ) => {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next:
        rows.length > limit && last !== undefined
          ? Option.some({ createdAt: last.createdAt, id: last.id })
          : Option.none(),
    };
  };

  return PaymentQueries.of({
    catalog: Effect.gen(function* () {
      if (!stripe.configured) {
        return { products: [], tip: Option.none() } satisfies Catalog;
      }
      const offered = (yield* repository.products(livemode)).filter(
        (product) => product.enabled && product.active,
      );
      const ids = offered.map((product) => product.id);
      const prices = (yield* repository.pricesOf(ids)).filter((price) =>
        sellable(price, livemode),
      );
      const roles = yield* repository.rolesOf(ids);
      const pricesOf = (productId: string) =>
        prices.filter((price) => price.productId === productId).map(priceView);
      const tip = Option.fromNullishOr(
        offered.find((product) => product.kind === "tip"),
      );
      return {
        products: offered
          .filter((product) => product.kind === "standard")
          .map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description,
            roles: roles.get(product.id) ?? [],
            prices: pricesOf(product.id),
          }))
          // A product without a price to sell is not on offer.
          .filter((product) => product.prices.length > 0),
        tip: Option.map(tip, (product) => ({
          productId: product.id,
          name: product.name,
          presets: pricesOf(product.id).filter((price) =>
            Option.isNone(price.recurring),
          ),
          minimum: {
            amount: settings.tipMinimum,
            currency: settings.tipCurrency,
          },
          maximum: {
            amount: settings.tipMaximum,
            currency: settings.tipCurrency,
          },
        })),
      } satisfies Catalog;
    }).pipe(Effect.withSpan("PaymentQueries.catalog"), Query.boundary),

    mine: Effect.fn("PaymentQueries.mine")(function* (
      subject: typeof Subject.Type,
    ) {
      const user = yield* users.findBySubject(subject);
      if (Option.isNone(user)) {
        return { subscriptions: [], payments: [] } satisfies MyPayments;
      }
      const subscriptions = yield* subscriptionsView(
        yield* repository.subscriptionsOfUser(user.value.id, livemode),
      );
      const payments = yield* paymentsView(
        yield* repository.paymentsOfUser(user.value.id, livemode),
      );
      return {
        subscriptions: subscriptions.map(ownSubscription),
        payments: payments.map(ownPayment),
      } satisfies MyPayments;
    }, Query.boundary),

    payments: Effect.fn("PaymentQueries.payments")(function* (query: {
      readonly limit: number;
      readonly after: Option.Option<PaymentCursorPosition>;
      readonly userId: Option.Option<UserId>;
      readonly status: Option.Option<PaymentStatus>;
    }) {
      yield* Authorized("admin");
      const rows = yield* repository.paymentPage({
        ...query,
        livemode,
        limit: query.limit + 1,
      });
      const { items, next } = page(rows, query.limit);
      return {
        payments: yield* paymentsView(items),
        nextCursor: Option.getOrNull(
          next as Option.Option<PaymentCursorPosition>,
        ),
      } satisfies AdminPaymentPage;
    }, Query.boundary),

    payment: Effect.fn("PaymentQueries.payment")(function* (id: PaymentId) {
      yield* Authorized("admin");
      const row = yield* repository.findPayment(id);
      if (Option.isNone(row)) return Option.none<AdminPayment>();
      const [view] = yield* paymentsView([row.value]);
      return Option.fromNullishOr(view);
    }, Query.boundary),

    subscriptions: Effect.fn("PaymentQueries.subscriptions")(function* (query: {
      readonly limit: number;
      readonly after: Option.Option<SubscriptionCursorPosition>;
      readonly userId: Option.Option<UserId>;
      readonly status: Option.Option<SubscriptionStatus>;
    }) {
      yield* Authorized("admin");
      const rows = yield* repository.subscriptionPage({
        ...query,
        livemode,
        limit: query.limit + 1,
      });
      const { items, next } = page(rows, query.limit);
      return {
        subscriptions: yield* subscriptionsView(items),
        nextCursor: Option.getOrNull(
          next as Option.Option<SubscriptionCursorPosition>,
        ),
      } satisfies AdminSubscriptionPage;
    }, Query.boundary),

    products: Effect.gen(function* () {
      yield* Authorized("admin");
      return yield* productsView(yield* repository.products(livemode));
    }).pipe(Effect.withSpan("PaymentQueries.products"), Query.boundary),

    product: Effect.fn("PaymentQueries.product")(function* (id: string) {
      const row = yield* repository.findProduct(id);
      if (Option.isNone(row)) return Option.none<AdminProduct>();
      const [view] = yield* productsView([row.value]);
      return Option.fromNullishOr(view);
    }, Query.boundary),

    insights: Effect.gen(function* () {
      yield* Authorized("admin");
      const now = yield* DateTime.now;
      const since = DateTime.subtractDuration(now, Duration.days(30));
      const recurring = yield* repository.activeRecurring(livemode);
      return {
        revenueLast30Days: sumByCurrency(
          yield* repository.revenue(livemode, Option.some(since)),
        ),
        revenueTotal: sumByCurrency(
          yield* repository.revenue(livemode, Option.none()),
        ),
        refundedTotal: sumByCurrency(yield* repository.refunded(livemode)),
        monthlyRecurringRevenue: sumByCurrency(
          recurring.map((price) => ({
            currency: price.currency,
            amount: monthlyAmount(
              price.unitAmount,
              price.recurringInterval,
              price.recurringIntervalCount,
            ),
          })),
        ),
        activeSubscriptions: yield* repository.activeSubscriptions(livemode),
        livemode,
      } satisfies PaymentInsights;
    }).pipe(Effect.withSpan("PaymentQueries.insights"), Query.boundary),
  });
});

/**
 * Reading the payments domain: the public catalog, a buyer's own
 * subscriptions and payments, and for admins every payment, subscription
 * and product and the revenue figures. Only rows of the current Stripe mode
 * (test or live) are read.
 *
 * @effect-expect-leaking Authorized<"admin">
 */
export class PaymentQueries extends Context.Service<
  PaymentQueries,
  {
    /** What is on offer; empty while Stripe is not configured. */
    readonly catalog: Effect.Effect<Catalog>;
    /** The subscriptions and payments of the user with this `sub`. */
    readonly mine: (subject: typeof Subject.Type) => Effect.Effect<MyPayments>;
    readonly payments: (query: {
      readonly limit: number;
      readonly after: Option.Option<PaymentCursorPosition>;
      readonly userId: Option.Option<UserId>;
      readonly status: Option.Option<PaymentStatus>;
    }) => Effect.Effect<AdminPaymentPage, never, Authorized<"admin">>;
    readonly payment: (
      id: PaymentId,
    ) => Effect.Effect<Option.Option<AdminPayment>, never, Authorized<"admin">>;
    readonly subscriptions: (query: {
      readonly limit: number;
      readonly after: Option.Option<SubscriptionCursorPosition>;
      readonly userId: Option.Option<UserId>;
      readonly status: Option.Option<SubscriptionStatus>;
    }) => Effect.Effect<AdminSubscriptionPage, never, Authorized<"admin">>;
    readonly products: Effect.Effect<
      ReadonlyArray<AdminProduct>,
      never,
      Authorized<"admin">
    >;
    /**
     * One product as admins see it. No proof: the commands that changed it
     * (admins' or superAdmins') answer with it.
     */
    readonly product: (
      id: string,
    ) => Effect.Effect<Option.Option<AdminProduct>>;
    readonly insights: Effect.Effect<
      PaymentInsights,
      never,
      Authorized<"admin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/payments/PaymentQueries") {
  /** Needs `PaymentRepository`, `Stripe` and `UserDirectory`. */
  static readonly layer = Layer.effect(PaymentQueries, make);
}
