import { assert, describe, layer } from "@effect/vitest";
import {
  AlreadyEntitled,
  InvalidWebhookSignature,
  type PaymentId,
  PaymentPriceNotFound,
  PaymentProductNotFound,
  PaymentsUnavailable,
  ProductKindConflict,
  type PurchasableRole,
  RefundNotAllowed,
  TipAmountOutOfRange,
  TipsUnavailable,
} from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Outbox } from "#cqrs/Outbox";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { UserCommands } from "#domains/users/UserCommands";
import type {
  StripeEventRefs,
  StripePaymentIntent,
} from "#infrastructure/Stripe";
import { makeFakeStripe, product, signed } from "#testing/Stripe";
import {
  asAdmin,
  asSuperAdmin,
  type Member,
  member,
  usersTestWith,
} from "#testing/Users";
import { PaymentCommands } from "./PaymentCommands.ts";
import { PaymentQueries } from "./PaymentQueries.ts";
import {
  CancelCustomerSubscriptions,
  HandleStripeEvent,
} from "./StripeTopics.ts";

/** A Stripe id with a prefix, unique per call: the tests share a database. */
const fresh = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

interface PriceSpec {
  readonly amount: number;
  readonly interval?: "day" | "week" | "month" | "year";
  readonly active?: boolean;
}

/**
 * Helpers around one fake Stripe: what a test puts into Stripe (`put…`),
 * how it mirrors it (`handle`, as the outbox consumer would) and how it
 * reads the result.
 */
const kit = (fake: ReturnType<typeof makeFakeStripe>) => {
  const { state } = fake;

  /**
   * Creates a product in Stripe, mirrors it and (unless `enabled: false`)
   * offers it, with the roles it grants.
   */
  const offer = Effect.fnUntraced(function* (
    prices: ReadonlyArray<PriceSpec>,
    options: {
      readonly roles?: ReadonlyArray<PurchasableRole>;
      readonly enabled?: boolean;
      readonly kind?: "standard" | "tip";
    } = {},
  ) {
    const commands = yield* PaymentCommands;
    const productId = fresh("prod");
    const priced = prices.map((price) => ({ ...price, id: fresh("price") }));
    state.products.set(productId, product(productId, priced));
    const admin = yield* member("admin");
    yield* commands.syncCatalog.pipe(asAdmin(admin));
    yield* commands
      .updateProduct(productId, {
        enabled: options.enabled ?? true,
        kind: options.kind ?? "standard",
      })
      .pipe(asAdmin(admin));
    if (options.roles !== undefined) {
      const root = yield* member("superAdmin");
      yield* commands
        .setProductRoles(productId, options.roles)
        .pipe(asSuperAdmin(root));
    }
    return { productId, priceIds: priced.map((price) => price.id) };
  });

  /** A Stripe customer of `user`, made earlier. */
  const giveCustomer = (user: Member) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const customerId = fresh("cus");
      yield* sql`
        INSERT INTO stripe_customers (user_id, livemode, customer_id, created_at)
        VALUES (${user.user.id}, false, ${customerId}, now())
      `;
      return customerId;
    });

  const putSubscription = (input: {
    readonly id: string;
    readonly customerId: string;
    readonly status: string;
    readonly productId: string;
    readonly priceId?: string;
  }) =>
    state.subscriptions.set(input.id, {
      id: input.id,
      customerId: input.customerId,
      status: input.status,
      productId: Option.some(input.productId),
      priceId: Option.fromNullishOr(input.priceId),
      currentPeriodEnd: Option.some(1_900_000_000),
      cancelAtPeriodEnd: false,
      canceledAt: Option.none(),
      created: 1_700_000_000,
      livemode: false,
    });

  const putIntent = (
    id: string,
    overrides: Partial<StripePaymentIntent> = {},
  ) =>
    state.paymentIntents.set(id, {
      id,
      status: "succeeded",
      amount: 1000,
      amountReceived: 1000,
      amountRefunded: 0,
      currency: "eur",
      disputeStatus: Option.none(),
      created: 1_700_000_000,
      livemode: false,
      ...overrides,
    });

  /** A completed one-off Checkout session and the intent it paid with. */
  const putPurchase = (input: {
    readonly sessionId: string;
    readonly intentId: string;
    readonly customerId: string;
    readonly productId: string;
    readonly amount?: number;
  }) => {
    putIntent(input.intentId, {
      amount: input.amount ?? 1000,
      amountReceived: input.amount ?? 1000,
    });
    state.checkoutSessions.set(input.sessionId, {
      id: input.sessionId,
      mode: "payment",
      productId: Option.some(input.productId),
      status: Option.some("complete"),
      paymentStatus: "paid",
      customerId: Option.some(input.customerId),
      subscriptionId: Option.none(),
      paymentIntentId: Option.some(input.intentId),
      amountTotal: Option.some(input.amount ?? 1000),
      currency: Option.some("eur"),
      metadata: { kind: "purchase", productId: input.productId },
      created: 1_700_000_000,
      livemode: false,
    });
  };

  /** Mirrors what the event is about, as the outbox consumer does. */
  const handle = (refs: StripeEventRefs) =>
    Effect.flatMap(PaymentCommands, (commands) =>
      commands.handleEvent({
        eventId: fresh("evt"),
        type: "test.event",
        refs,
      }),
    );

  const rolesOf = (user: Member) =>
    Effect.flatMap(ModerationQueries, (queries) =>
      queries.accessOf(user.subject),
    ).pipe(Effect.map(({ roles }) => roles));

  const holdsFoodPlanner = (user: Member) =>
    Effect.map(rolesOf(user), (roles) => roles.includes("foodPlanner"));

  /** Whether the user's `foodPlanner` is a manual grant; None if they lack it. */
  const manualOf = (user: Member) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly manual: boolean }>`
        SELECT manual FROM user_roles
        WHERE user_id = ${user.user.id} AND role = 'foodPlanner'
      `;
      return Option.fromNullishOr(rows[0]?.manual);
    });

  const paymentsOf = (user: Member) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        readonly id: PaymentId;
        readonly kind: string;
        readonly status: string;
        readonly amount: number;
        readonly amountRefunded: number;
        readonly productId: string | null;
      }>`
        SELECT id, kind, status, amount, amount_refunded, product_id
        FROM payments WHERE user_id = ${user.user.id}
        ORDER BY created_at, id
      `;
    });

  /** A user with a customer and an active subscription to a new product. */
  const subscriber = Effect.gen(function* () {
    const { productId, priceIds } = yield* offer(
      [{ amount: 500, interval: "month" }],
      { roles: ["foodPlanner"] },
    );
    const user = yield* member();
    const customerId = yield* giveCustomer(user);
    const subscriptionId = fresh("sub");
    const subscribe = (status: string) => {
      putSubscription({
        id: subscriptionId,
        customerId,
        status,
        productId,
        priceId: priceIds[0]!,
      });
      return handle({ subscriptionId });
    };
    return { user, customerId, productId, priceIds, subscriptionId, subscribe };
  });

  /** A user with a customer and a paid one-off purchase of a new product. */
  const buyer = Effect.gen(function* () {
    const { productId, priceIds } = yield* offer([{ amount: 1000 }], {
      roles: ["foodPlanner"],
    });
    const user = yield* member();
    const customerId = yield* giveCustomer(user);
    const sessionId = fresh("cs");
    const intentId = fresh("pi");
    putPurchase({ sessionId, intentId, customerId, productId });
    yield* handle({ checkoutSessionId: sessionId });
    return { user, customerId, productId, priceIds, sessionId, intentId };
  });

  return {
    state,
    offer,
    giveCustomer,
    putSubscription,
    putIntent,
    putPurchase,
    handle,
    rolesOf,
    holdsFoodPlanner,
    manualOf,
    paymentsOf,
    subscriber,
    buyer,
  };
};

const checkoutCount = (fake: ReturnType<typeof makeFakeStripe>, user: Member) =>
  fake.state.checkouts.filter((checkout) => checkout.userId === user.user.id);

const outboxCount = (topic: string, key: string, value: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly n: number }>`
      SELECT count(*)::int AS n FROM outbox
      WHERE topic = ${topic} AND payload->>${key} = ${value}
    `;
    return rows[0]?.n ?? 0;
  });

describe("PaymentCommands", () => {
  const fake = makeFakeStripe();
  const t = kit(fake);

  layer(usersTestWith(fake.layer), { timeout: "30 seconds" })((it) => {
    describe("the catalog", () => {
      it.effect("offers a mirrored product only once an admin enables it", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const { productId, priceIds } = yield* t.offer(
            [{ amount: 500, interval: "month" }],
            { enabled: false },
          );
          const listed = () =>
            Effect.map(queries.catalog, (catalog) =>
              catalog.products.find((item) => item.id === productId),
            );
          assert.isUndefined(yield* listed());

          const commands = yield* PaymentCommands;
          const admin = yield* member("admin");
          yield* commands
            .updateProduct(productId, { enabled: true, kind: "standard" })
            .pipe(asAdmin(admin));
          const offered = yield* listed();
          assert.deepStrictEqual(offered?.prices, [
            {
              id: priceIds[0],
              amount: { amount: 500, currency: "eur" },
              recurring: Option.some({
                interval: "month" as const,
                intervalCount: 1,
              }),
            },
          ]);

          yield* commands
            .updateProduct(productId, { enabled: false, kind: "standard" })
            .pipe(asAdmin(admin));
          assert.isUndefined(yield* listed());
        }),
      );

      it.effect("leaves out inactive prices and products without a price", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const mixed = yield* t.offer([
            { amount: 500, interval: "month" },
            { amount: 900, interval: "year", active: false },
          ]);
          const unpriced = yield* t.offer([{ amount: 700, active: false }]);
          const catalog = yield* queries.catalog;
          assert.deepStrictEqual(
            catalog.products
              .find((item) => item.id === mixed.productId)
              ?.prices.map((price) => price.id),
            [mixed.priceIds[0]],
          );
          assert.isUndefined(
            catalog.products.find((item) => item.id === unpriced.productId),
          );
        }),
      );

      it.effect("leaves out products that are inactive in Stripe", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const commands = yield* PaymentCommands;
          const { productId } = yield* t.offer([{ amount: 500 }]);
          fake.state.products.set(
            productId,
            product(productId, [], { active: false }),
          );
          const admin = yield* member("admin");
          yield* commands.syncCatalog.pipe(asAdmin(admin));
          assert.isUndefined(
            (yield* queries.catalog).products.find(
              (item) => item.id === productId,
            ),
          );
        }),
      );

      it.effect("does not mirror products of the other mode", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const commands = yield* PaymentCommands;
          const productId = fresh("prod");
          fake.state.products.set(
            productId,
            product(productId, [{ id: fresh("price"), amount: 500 }], {
              livemode: true,
            }),
          );
          const admin = yield* member("admin");
          yield* commands.syncCatalog.pipe(asAdmin(admin));
          assert.isTrue(Option.isNone(yield* queries.product(productId)));
          const failure = yield* commands
            .updateProduct(productId, { enabled: true, kind: "standard" })
            .pipe(asAdmin(admin), Effect.flip);
          assert.instanceOf(failure, PaymentProductNotFound);
        }),
      );

      it.effect("stops offering a product deleted in Stripe", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const commands = yield* PaymentCommands;
          const { productId } = yield* t.offer([{ amount: 500 }]);
          fake.state.products.delete(productId);
          const admin = yield* member("admin");
          yield* commands.syncCatalog.pipe(asAdmin(admin));
          assert.isUndefined(
            (yield* queries.catalog).products.find(
              (item) => item.id === productId,
            ),
          );
        }),
      );

      it.effect("lists the roles a product grants", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const { productId } = yield* t.offer([{ amount: 500 }], {
            roles: ["foodPlanner"],
          });
          assert.deepStrictEqual(
            (yield* queries.catalog).products.find(
              (item) => item.id === productId,
            )?.roles,
            ["foodPlanner"],
          );
        }),
      );
    });

    describe("product settings", () => {
      it.effect("refuses roles for a product that is not known", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const root = yield* member("superAdmin");
          const failure = yield* commands
            .setProductRoles(fresh("prod"), ["foodPlanner"])
            .pipe(asSuperAdmin(root), Effect.flip);
          assert.instanceOf(failure, PaymentProductNotFound);
        }),
      );

      it.effect("refuses to make a product with roles the tip product", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { productId } = yield* t.offer([{ amount: 500 }], {
            roles: ["foodPlanner"],
          });
          const admin = yield* member("admin");
          const failure = yield* commands
            .updateProduct(productId, { enabled: true, kind: "tip" })
            .pipe(asAdmin(admin), Effect.flip);
          assert.instanceOf(failure, ProductKindConflict);
        }),
      );

      it.effect("applies new roles to everyone who already pays", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { productId } = yield* t.offer([
            { amount: 500, interval: "month" },
          ]);
          const ada = yield* member();
          const customerId = yield* t.giveCustomer(ada);
          const id = fresh("sub");
          t.putSubscription({ id, customerId, status: "active", productId });
          yield* t.handle({ subscriptionId: id });
          assert.isFalse(yield* t.holdsFoodPlanner(ada));

          const root = yield* member("superAdmin");
          yield* commands
            .setProductRoles(productId, ["foodPlanner"])
            .pipe(asSuperAdmin(root));
          assert.isTrue(yield* t.holdsFoodPlanner(ada));

          yield* commands
            .setProductRoles(productId, [])
            .pipe(asSuperAdmin(root));
          assert.isFalse(yield* t.holdsFoodPlanner(ada));
        }),
      );
    });

    describe("startCheckout", () => {
      it.effect("starts a subscription checkout for a recurring price", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { productId, priceIds } = yield* t.offer(
            [{ amount: 500, interval: "month" }],
            { roles: ["foodPlanner"] },
          );
          const ada = yield* member();
          const redirect = yield* commands.startCheckout(ada.subject, {
            kind: "price",
            priceId: priceIds[0]!,
          });
          assert.match(redirect.url, /^https:\/\/checkout\.stripe\.com\//u);
          const [checkout] = checkoutCount(fake, ada);
          assert.strictEqual(checkout?.mode, "subscription");
          assert.deepStrictEqual(checkout?.lineItem, {
            _tag: "Price",
            priceId: priceIds[0],
          });
          assert.deepStrictEqual(checkout?.metadata, {
            kind: "subscription",
            productId,
          });
        }),
      );

      it.effect("starts a payment checkout for a one-off price", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { productId, priceIds } = yield* t.offer([{ amount: 1000 }]);
          const ada = yield* member();
          yield* commands.startCheckout(ada.subject, {
            kind: "price",
            priceId: priceIds[0]!,
          });
          const [checkout] = checkoutCount(fake, ada);
          assert.strictEqual(checkout?.mode, "payment");
          assert.deepStrictEqual(checkout?.metadata, {
            kind: "purchase",
            productId,
          });
        }),
      );

      it.effect("makes one Stripe customer and reuses it", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const sql = yield* SqlClient.SqlClient;
          const monthly = yield* t.offer([{ amount: 500, interval: "month" }]);
          const once = yield* t.offer([{ amount: 1000 }]);
          const ada = yield* member();
          for (const priceId of [monthly.priceIds[0]!, once.priceIds[0]!]) {
            yield* commands.startCheckout(ada.subject, {
              kind: "price",
              priceId,
            });
          }
          const checkouts = checkoutCount(fake, ada);
          assert.lengthOf(checkouts, 2);
          assert.lengthOf(
            fake.state.customers.filter((c) => c.userId === ada.user.id),
            1,
          );
          assert.strictEqual(
            checkouts[0]?.customerId,
            checkouts[1]?.customerId,
          );
          const rows = yield* sql<{ readonly customerId: string }>`
            SELECT customer_id FROM stripe_customers
            WHERE user_id = ${ada.user.id}
          `;
          assert.deepStrictEqual(rows, [
            { customerId: checkouts[0]?.customerId },
          ]);
        }),
      );

      it.effect("uses the customer it already knows", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { priceIds } = yield* t.offer([{ amount: 1000 }]);
          const ada = yield* member();
          const customerId = yield* t.giveCustomer(ada);
          yield* commands.startCheckout(ada.subject, {
            kind: "price",
            priceId: priceIds[0]!,
          });
          assert.strictEqual(
            checkoutCount(fake, ada)[0]?.customerId,
            customerId,
          );
          assert.lengthOf(
            fake.state.customers.filter((c) => c.userId === ada.user.id),
            0,
          );
        }),
      );

      it.effect(
        "answers PaymentPriceNotFound for a price that is not offered",
        () =>
          Effect.gen(function* () {
            const commands = yield* PaymentCommands;
            const ada = yield* member();
            const disabled = yield* t.offer([{ amount: 500 }], {
              enabled: false,
            });
            const inactive = yield* t.offer([
              { amount: 500 },
              { amount: 600, active: false },
            ]);
            for (const priceId of [
              fresh("price"),
              disabled.priceIds[0]!,
              inactive.priceIds[1]!,
            ]) {
              const failure = yield* commands
                .startCheckout(ada.subject, { kind: "price", priceId })
                .pipe(Effect.flip);
              assert.instanceOf(failure, PaymentPriceNotFound);
              assert.strictEqual(
                (failure as PaymentPriceNotFound).price,
                priceId,
              );
            }
            assert.lengthOf(checkoutCount(fake, ada), 0);
          }),
      );

      it.effect("answers TipsUnavailable while there is no tip product", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const ada = yield* member();
          const failure = yield* commands
            .startCheckout(ada.subject, { kind: "tip", amount: 500 })
            .pipe(Effect.flip);
          assert.instanceOf(failure, TipsUnavailable);
        }),
      );

      it.effect("answers AlreadyEntitled for a live subscription", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { productId, priceIds } = yield* t.offer(
            [{ amount: 500, interval: "month" }],
            { roles: ["foodPlanner"] },
          );
          const ada = yield* member();
          const request = { kind: "price", priceId: priceIds[0]! } as const;
          yield* commands.startCheckout(ada.subject, request);
          const customerId = fake.state.customers.find(
            (c) => c.userId === ada.user.id,
          )!.id;
          const id = fresh("sub");
          t.putSubscription({ id, customerId, status: "past_due", productId });
          yield* t.handle({ subscriptionId: id });

          const failure = yield* commands
            .startCheckout(ada.subject, request)
            .pipe(Effect.flip);
          assert.deepStrictEqual(
            failure,
            new AlreadyEntitled({ product: productId, reason: "subscribed" }),
          );

          // Once it has ended they can subscribe again.
          t.putSubscription({ id, customerId, status: "canceled", productId });
          yield* t.handle({ subscriptionId: id });
          yield* commands.startCheckout(ada.subject, request);
          assert.lengthOf(checkoutCount(fake, ada), 2);
        }),
      );

      it.effect("answers AlreadyEntitled for a paid purchase", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const bought = yield* t.buyer;
          const failure = yield* commands
            .startCheckout(bought.user.subject, {
              kind: "price",
              priceId: bought.priceIds[0]!,
            })
            .pipe(Effect.flip);
          assert.deepStrictEqual(
            failure,
            new AlreadyEntitled({
              product: bought.productId,
              reason: "purchased",
            }),
          );
        }),
      );

      it.effect("lets a buyer purchase again after a full refund", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const bought = yield* t.buyer;
          t.putIntent(bought.intentId, { amountRefunded: 1000 });
          yield* t.handle({ paymentIntentId: bought.intentId });
          yield* commands.startCheckout(bought.user.subject, {
            kind: "price",
            priceId: bought.priceIds[0]!,
          });
          assert.lengthOf(checkoutCount(fake, bought.user), 1);
        }),
      );

      it.effect("fails with PaymentProviderFailed when Stripe does", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { priceIds } = yield* t.offer([{ amount: 1000 }]);
          const ada = yield* member();
          fake.state.failWith = Option.some("api:500:oops");
          const failure = yield* commands
            .startCheckout(ada.subject, {
              kind: "price",
              priceId: priceIds[0]!,
            })
            .pipe(
              Effect.flip,
              Effect.ensuring(
                Effect.sync(() => {
                  fake.state.failWith = Option.none();
                }),
              ),
            );
          assert.strictEqual(failure._tag, "PaymentProviderFailed");
        }),
      );
    });

    describe("subscriptions", () => {
      it.effect(
        "grants the roles while active and revokes them at once when past due",
        () =>
          Effect.gen(function* () {
            const sub = yield* t.subscriber;
            assert.isFalse(yield* t.holdsFoodPlanner(sub.user));

            yield* sub.subscribe("active");
            assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
            assert.deepStrictEqual(
              yield* t.manualOf(sub.user),
              Option.some(false),
            );

            yield* sub.subscribe("past_due");
            assert.isFalse(yield* t.holdsFoodPlanner(sub.user));

            yield* sub.subscribe("active");
            assert.isTrue(yield* t.holdsFoodPlanner(sub.user));

            yield* sub.subscribe("canceled");
            assert.isFalse(yield* t.holdsFoodPlanner(sub.user));
          }),
      );

      it.effect("grants the roles during a trial", () =>
        Effect.gen(function* () {
          const sub = yield* t.subscriber;
          yield* sub.subscribe("trialing");
          assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
        }),
      );

      it.effect("grants nothing for a status Stripe adds later", () =>
        Effect.gen(function* () {
          const sub = yield* t.subscriber;
          yield* sub.subscribe("something_new");
          assert.isFalse(yield* t.holdsFoodPlanner(sub.user));
        }),
      );

      it.effect("mirrors the subscription", () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const sub = yield* t.subscriber;
          yield* sub.subscribe("past_due");
          const mine = yield* queries.mine(sub.user.subject);
          assert.deepStrictEqual(
            mine.subscriptions.map((item) => [
              item.id,
              item.status,
              item.product,
            ]),
            [
              [
                sub.subscriptionId,
                "pastDue",
                Option.some({
                  id: sub.productId,
                  name: `Product ${sub.productId}`,
                }),
              ],
            ],
          );
        }),
      );

      it.effect(
        "keeps a role a superAdmin granted when the subscription ends",
        () =>
          Effect.gen(function* () {
            const moderation = yield* ModerationCommands;
            const root = yield* member("superAdmin");
            const sub = yield* t.subscriber;
            yield* moderation
              .grantRole(sub.user.user.id, "foodPlanner")
              .pipe(asSuperAdmin(root));
            yield* sub.subscribe("active");
            yield* sub.subscribe("canceled");
            assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
            assert.deepStrictEqual(
              yield* t.manualOf(sub.user),
              Option.some(true),
            );
          }),
      );

      it.effect("turns a role held through payment into a manual grant", () =>
        Effect.gen(function* () {
          const moderation = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const sub = yield* t.subscriber;
          yield* sub.subscribe("active");
          assert.deepStrictEqual(
            yield* t.manualOf(sub.user),
            Option.some(false),
          );

          yield* moderation
            .grantRole(sub.user.user.id, "foodPlanner")
            .pipe(asSuperAdmin(root));
          assert.deepStrictEqual(
            yield* t.manualOf(sub.user),
            Option.some(true),
          );

          yield* sub.subscribe("canceled");
          assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
        }),
      );

      it.effect("ignores subscriptions of the other mode", () =>
        Effect.gen(function* () {
          const sub = yield* t.subscriber;
          t.putSubscription({
            id: sub.subscriptionId,
            customerId: sub.customerId,
            status: "active",
            productId: sub.productId,
          });
          fake.state.subscriptions.set(sub.subscriptionId, {
            ...fake.state.subscriptions.get(sub.subscriptionId)!,
            livemode: true,
          });
          yield* t.handle({ subscriptionId: sub.subscriptionId });
          assert.isFalse(yield* t.holdsFoodPlanner(sub.user));
        }),
      );
    });

    describe("one-off purchases", () => {
      it.effect("records a paid purchase and grants its roles", () =>
        Effect.gen(function* () {
          const bought = yield* t.buyer;
          assert.isTrue(yield* t.holdsFoodPlanner(bought.user));
          const [payment] = yield* t.paymentsOf(bought.user);
          assert.strictEqual(payment?.kind, "purchase");
          assert.strictEqual(payment?.status, "paid");
          assert.strictEqual(payment?.amount, 1000);
          assert.strictEqual(payment?.productId, bought.productId);
        }),
      );

      it.effect("records a repeated event once", () =>
        Effect.gen(function* () {
          const bought = yield* t.buyer;
          yield* t.handle({ checkoutSessionId: bought.sessionId });
          yield* t.handle({ paymentIntentId: bought.intentId });
          assert.lengthOf(yield* t.paymentsOf(bought.user), 1);
        }),
      );

      it.effect("ignores a checkout session that is not complete", () =>
        Effect.gen(function* () {
          const bought = yield* t.buyer;
          const sessionId = fresh("cs");
          t.putPurchase({
            sessionId,
            intentId: fresh("pi"),
            customerId: bought.customerId,
            productId: bought.productId,
          });
          fake.state.checkoutSessions.set(sessionId, {
            ...fake.state.checkoutSessions.get(sessionId)!,
            status: Option.some("expired"),
          });
          yield* t.handle({ checkoutSessionId: sessionId });
          assert.lengthOf(yield* t.paymentsOf(bought.user), 1);
        }),
      );

      it.effect("takes the product from the line item, not the metadata", () =>
        Effect.gen(function* () {
          const granting = yield* t.offer([{ amount: 1000 }], {
            roles: ["foodPlanner"],
          });
          const plain = yield* t.offer([{ amount: 200 }]);
          const ada = yield* member();
          const customerId = yield* t.giveCustomer(ada);
          const sessionId = fresh("cs");
          t.putPurchase({
            sessionId,
            intentId: fresh("pi"),
            customerId,
            productId: plain.productId,
          });
          // Metadata that claims the product with a role.
          fake.state.checkoutSessions.set(sessionId, {
            ...fake.state.checkoutSessions.get(sessionId)!,
            metadata: { kind: "purchase", productId: granting.productId },
          });
          yield* t.handle({ checkoutSessionId: sessionId });
          const [payment] = yield* t.paymentsOf(ada);
          assert.strictEqual(payment?.productId, plain.productId);
          assert.isFalse(yield* t.holdsFoodPlanner(ada));
        }),
      );

      it.effect("revokes the roles after a full refund", () =>
        Effect.gen(function* () {
          const bought = yield* t.buyer;
          t.putIntent(bought.intentId, { amountRefunded: 1000 });
          yield* t.handle({ paymentIntentId: bought.intentId });
          const [payment] = yield* t.paymentsOf(bought.user);
          assert.strictEqual(payment?.status, "refunded");
          assert.strictEqual(payment?.amountRefunded, 1000);
          assert.isFalse(yield* t.holdsFoodPlanner(bought.user));
        }),
      );

      it.effect("keeps the roles after a partial refund", () =>
        Effect.gen(function* () {
          const bought = yield* t.buyer;
          t.putIntent(bought.intentId, { amountRefunded: 400 });
          yield* t.handle({ paymentIntentId: bought.intentId });
          const [payment] = yield* t.paymentsOf(bought.user);
          assert.strictEqual(payment?.status, "partiallyRefunded");
          assert.strictEqual(payment?.amountRefunded, 400);
          assert.isTrue(yield* t.holdsFoodPlanner(bought.user));
        }),
      );

      it.effect(
        "keeps the roles during a dispute and revokes them when it is lost",
        () =>
          Effect.gen(function* () {
            const bought = yield* t.buyer;
            t.putIntent(bought.intentId, {
              disputeStatus: Option.some("needs_response"),
            });
            yield* t.handle({ paymentIntentId: bought.intentId });
            assert.strictEqual(
              (yield* t.paymentsOf(bought.user))[0]?.status,
              "disputed",
            );
            assert.isTrue(yield* t.holdsFoodPlanner(bought.user));

            t.putIntent(bought.intentId, {
              disputeStatus: Option.some("lost"),
            });
            yield* t.handle({ paymentIntentId: bought.intentId });
            assert.strictEqual(
              (yield* t.paymentsOf(bought.user))[0]?.status,
              "disputeLost",
            );
            assert.isFalse(yield* t.holdsFoodPlanner(bought.user));
          }),
      );
    });

    describe("invoices", () => {
      const invoice = (
        subscriptionId: string,
        customerId: string,
        overrides: { status: string; amountPaid: number },
      ) => {
        const id = fresh("in");
        fake.state.invoices.set(id, {
          id,
          status: Option.some(overrides.status),
          customerId: Option.some(customerId),
          subscriptionId: Option.some(subscriptionId),
          paymentIntentId: Option.none(),
          amountPaid: overrides.amountPaid,
          currency: "eur",
          created: 1_700_000_000,
          livemode: false,
        });
        return id;
      };

      it.effect("records a paid invoice as a subscription payment", () =>
        Effect.gen(function* () {
          const sub = yield* t.subscriber;
          yield* sub.subscribe("active");
          const id = invoice(sub.subscriptionId, sub.customerId, {
            status: "paid",
            amountPaid: 500,
          });
          yield* t.handle({ invoiceId: id });
          yield* t.handle({ invoiceId: id });
          const payments = yield* t.paymentsOf(sub.user);
          assert.deepStrictEqual(
            payments.map(({ kind, status, amount, productId }) => ({
              kind,
              status,
              amount,
              productId,
            })),
            [
              {
                kind: "subscription",
                status: "paid",
                amount: 500,
                productId: sub.productId,
              },
            ],
          );
        }),
      );

      it.effect(
        "records no payment for an invoice without a subscription",
        () =>
          Effect.gen(function* () {
            const bought = yield* t.buyer;
            // What `STRIPE_CHECKOUT_INVOICES` adds to a one-off checkout.
            const id = fresh("in");
            fake.state.invoices.set(id, {
              id,
              status: Option.some("paid"),
              customerId: Option.some(bought.customerId),
              subscriptionId: Option.none(),
              paymentIntentId: Option.some(bought.intentId),
              amountPaid: 1000,
              currency: "eur",
              created: 1_700_000_000,
              livemode: false,
            });
            yield* t.handle({ invoiceId: id });
            const payments = yield* t.paymentsOf(bought.user);
            assert.deepStrictEqual(
              payments.map(({ kind }) => kind),
              ["purchase"],
            );
            assert.isTrue(yield* t.holdsFoodPlanner(bought.user));
          }),
      );

      it.effect("records no payment for an invoice that is not paid", () =>
        Effect.gen(function* () {
          const sub = yield* t.subscriber;
          yield* sub.subscribe("past_due");
          yield* t.handle({
            invoiceId: invoice(sub.subscriptionId, sub.customerId, {
              status: "open",
              amountPaid: 0,
            }),
          });
          yield* t.handle({
            invoiceId: invoice(sub.subscriptionId, sub.customerId, {
              status: "paid",
              amountPaid: 0,
            }),
          });
          assert.lengthOf(yield* t.paymentsOf(sub.user), 0);
        }),
      );
    });

    describe("refund", () => {
      const auditRows = (paymentId: PaymentId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly action: string;
            readonly actorId: string;
            readonly targetId: string;
          }>`
            SELECT action, actor_id, target_id FROM audit_log
            WHERE action = 'payment_refunded' AND detail = ${paymentId}
          `;
        });

      it.effect(
        "refunds part of a payment, audited, and mirrors the result",
        () =>
          Effect.gen(function* () {
            const commands = yield* PaymentCommands;
            const admin = yield* member("admin");
            const bought = yield* t.buyer;
            const [payment] = yield* t.paymentsOf(bought.user);
            const paymentId = payment!.id;

            yield* commands
              .refund(paymentId, Option.some(300))
              .pipe(asAdmin(admin));

            assert.deepStrictEqual(
              fake.state.refunds.filter(
                (r) => r.paymentIntentId === bought.intentId,
              ),
              [
                {
                  paymentIntentId: bought.intentId,
                  amount: Option.some(300),
                  idempotencyKey: `refund-${paymentId}-0-300`,
                },
              ],
            );
            assert.deepStrictEqual(yield* auditRows(paymentId), [
              {
                action: "payment_refunded",
                actorId: admin.user.id,
                targetId: bought.user.user.id,
              },
            ]);
            const [after] = yield* t.paymentsOf(bought.user);
            assert.strictEqual(after?.status, "partiallyRefunded");
            assert.strictEqual(after?.amountRefunded, 300);
            assert.isTrue(yield* t.holdsFoodPlanner(bought.user));
          }),
      );

      it.effect("refunds what is left, which takes the roles away", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const admin = yield* member("admin");
          const bought = yield* t.buyer;
          const [payment] = yield* t.paymentsOf(bought.user);

          yield* commands
            .refund(payment!.id, Option.none())
            .pipe(asAdmin(admin));

          const [after] = yield* t.paymentsOf(bought.user);
          assert.strictEqual(after?.status, "refunded");
          assert.isFalse(yield* t.holdsFoodPlanner(bought.user));
        }),
      );

      it.effect("refuses more than is left", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const admin = yield* member("admin");
          const bought = yield* t.buyer;
          const [payment] = yield* t.paymentsOf(bought.user);
          const failure = yield* commands
            .refund(payment!.id, Option.some(1001))
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            failure,
            new RefundNotAllowed({ reason: "exceedsRemaining" }),
          );
          assert.lengthOf(
            fake.state.refunds.filter(
              (r) => r.paymentIntentId === bought.intentId,
            ),
            0,
          );
          assert.lengthOf(yield* auditRows(payment!.id), 0);
        }),
      );

      it.effect("refuses a payment that is not paid", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const admin = yield* member("admin");
          const bought = yield* t.buyer;
          const [payment] = yield* t.paymentsOf(bought.user);
          t.putIntent(bought.intentId, { amountRefunded: 1000 });
          yield* t.handle({ paymentIntentId: bought.intentId });
          const failure = yield* commands
            .refund(payment!.id, Option.none())
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            failure,
            new RefundNotAllowed({ reason: "notPaid" }),
          );
        }),
      );
    });

    describe("webhooks", () => {
      const subscriptionEvent = (eventId: string, subscriptionId: string) =>
        signed({
          id: eventId,
          type: "customer.subscription.updated",
          object: { id: subscriptionId, object: "subscription" },
        });

      it.effect("refuses a bad signature and queues nothing", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const eventId = fresh("evt");
          const { payload, signature } = subscriptionEvent(eventId, "sub_x");
          const forged = yield* commands
            .receiveWebhook(payload, "t=1,v1=00")
            .pipe(Effect.flip);
          assert.instanceOf(forged, InvalidWebhookSignature);
          const tampered = yield* commands
            .receiveWebhook(payload.replace("sub_x", "sub_y"), signature)
            .pipe(Effect.flip);
          assert.instanceOf(tampered, InvalidWebhookSignature);
          assert.strictEqual(
            yield* outboxCount(HandleStripeEvent.name, "eventId", eventId),
            0,
          );
        }),
      );

      it.effect("queues an event once, however often Stripe delivers it", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const eventId = fresh("evt");
          const { payload, signature } = subscriptionEvent(eventId, "sub_x");
          yield* commands.receiveWebhook(payload, signature);
          yield* commands.receiveWebhook(payload, signature);
          assert.strictEqual(
            yield* outboxCount("payments.stripe-event", "eventId", eventId),
            1,
          );
        }),
      );

      it.effect("ignores an event of the other mode", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const eventId = fresh("evt");
          const { payload, signature } = signed({
            id: eventId,
            type: "customer.subscription.updated",
            object: { id: "sub_x", object: "subscription" },
            livemode: true,
          });
          yield* commands.receiveWebhook(payload, signature);
          assert.strictEqual(
            yield* outboxCount("payments.stripe-event", "eventId", eventId),
            0,
          );
        }),
      );

      it.effect("grants the roles once the queued event is processed", () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const outbox = yield* Outbox;
          const sub = yield* t.subscriber;
          t.putSubscription({
            id: sub.subscriptionId,
            customerId: sub.customerId,
            status: "active",
            productId: sub.productId,
          });
          const { payload, signature } = subscriptionEvent(
            fresh("evt"),
            sub.subscriptionId,
          );
          yield* commands.receiveWebhook(payload, signature);
          assert.isFalse(yield* t.holdsFoodPlanner(sub.user));
          yield* outbox.process(HandleStripeEvent, commands.handleEvent);
          assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
        }),
      );
    });

    describe("background jobs", () => {
      it.effect("takes away paid roles the current mode does not back", () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const commands = yield* PaymentCommands;
          const sub = yield* t.subscriber;
          yield* sub.subscribe("active");
          // Granted by a payment of the other mode, which this one can't see.
          const stale = yield* member();
          yield* sql`
            INSERT INTO user_roles (user_id, role, manual)
            VALUES (${stale.user.id}, 'foodPlanner', false)
          `;
          assert.isAtLeast(yield* commands.resyncPaidRoles, 2);
          assert.isFalse(yield* t.holdsFoodPlanner(stale));
          assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
        }),
      );

      it.effect("forgets old webhook events", () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const commands = yield* PaymentCommands;
          // The test clock starts at 1970, so "old" is before that.
          const old = fresh("evt");
          const recent = fresh("evt");
          yield* sql`
            INSERT INTO stripe_events (id, type, livemode, received_at)
            VALUES (${old}, 'test', false, '1969-01-01T00:00:00Z'),
              (${recent}, 'test', false, now())
          `;
          assert.isAtLeast(yield* commands.purgeEventsOlderThan("30 days"), 1);
          const left = yield* sql<{ readonly id: string }>`
            SELECT id FROM stripe_events WHERE id IN (${old}, ${recent})
          `;
          assert.deepStrictEqual(
            left.map(({ id }) => id),
            [recent],
          );
        }),
      );
    });

    describe("account deletion", () => {
      it.effect("queues the cancellation for a user with a customer only", () =>
        Effect.gen(function* () {
          const users = yield* UserCommands;
          const withCustomer = yield* member();
          const customerId = yield* t.giveCustomer(withCustomer);
          const without = yield* member();
          yield* users.deleteAccount(withCustomer.subject);
          yield* users.deleteAccount(without.subject);
          assert.strictEqual(
            yield* outboxCount(
              CancelCustomerSubscriptions.name,
              "customerId",
              customerId,
            ),
            1,
          );
        }),
      );

      it.effect(
        "cancels only live subscriptions and leaves the user without roles",
        () =>
          Effect.gen(function* () {
            const users = yield* UserCommands;
            const commands = yield* PaymentCommands;
            const outbox = yield* Outbox;
            const sql = yield* SqlClient.SqlClient;
            const sub = yield* t.subscriber;
            yield* sub.subscribe("active");
            assert.isTrue(yield* t.holdsFoodPlanner(sub.user));
            const pastDue = fresh("sub");
            const ended = fresh("sub");
            t.putSubscription({
              id: pastDue,
              customerId: sub.customerId,
              status: "past_due",
              productId: sub.productId,
            });
            t.putSubscription({
              id: ended,
              customerId: sub.customerId,
              status: "canceled",
              productId: sub.productId,
            });

            yield* users.deleteAccount(sub.user.subject);
            yield* outbox.process(
              CancelCustomerSubscriptions,
              ({ customerId }) => commands.cancelSubscriptionsOf(customerId),
            );

            assert.sameMembers(
              fake.state.canceled.filter((id) =>
                [sub.subscriptionId, pastDue, ended].includes(id),
              ),
              [sub.subscriptionId, pastDue],
            );

            // Stripe's webhook for the cancellation does not bring roles back.
            yield* sub.subscribe("active");
            const roles = yield* sql<{ readonly role: string }>`
            SELECT role FROM user_roles WHERE user_id = ${sub.user.user.id}
          `;
            assert.deepStrictEqual(roles, []);
          }),
      );
    });
  });
});

describe("PaymentCommands with a tip product", () => {
  const fake = makeFakeStripe();
  const t = kit(fake);

  layer(usersTestWith(fake.layer), { timeout: "30 seconds" })((it) => {
    /** The one tip product of this database, made on first use. */
    const ensureTip = Effect.gen(function* () {
      const queries = yield* PaymentQueries;
      const existing = (yield* queries.catalog).tip;
      if (Option.isSome(existing)) return existing.value;
      yield* t.offer(
        [{ amount: 500 }, { amount: 1500 }, { amount: 300, interval: "month" }],
        { kind: "tip" },
      );
      return Option.getOrThrow((yield* queries.catalog).tip);
    });

    it.effect(
      "offers the tip product with presets and the configured bounds",
      () =>
        Effect.gen(function* () {
          const queries = yield* PaymentQueries;
          const tip = yield* ensureTip;
          assert.deepStrictEqual(
            tip.presets.map((preset) => preset.amount.amount),
            [500, 1500],
          );
          assert.deepStrictEqual(tip.minimum, { amount: 100, currency: "eur" });
          assert.deepStrictEqual(tip.maximum, {
            amount: 50_000,
            currency: "eur",
          });
          // It is not sold like the other products.
          assert.isUndefined(
            (yield* queries.catalog).products.find(
              (item) => item.id === tip.productId,
            ),
          );
        }),
    );

    it.effect("records a payment of the tip product as a tip", () =>
      Effect.gen(function* () {
        const tip = yield* ensureTip;
        const ada = yield* member();
        const customerId = yield* t.giveCustomer(ada);
        const sessionId = fresh("cs");
        t.putPurchase({
          sessionId,
          intentId: fresh("pi"),
          customerId,
          productId: tip.productId,
        });
        yield* t.handle({ checkoutSessionId: sessionId });
        const [payment] = yield* t.paymentsOf(ada);
        assert.strictEqual(payment?.kind, "tip");
        assert.isFalse(yield* t.holdsFoodPlanner(ada));
      }),
    );

    it.effect("starts a payment checkout for a custom tip", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        const tip = yield* ensureTip;
        const ada = yield* member();
        yield* commands.startCheckout(ada.subject, {
          kind: "tip",
          amount: 750,
        });
        const [checkout] = checkoutCount(fake, ada);
        assert.strictEqual(checkout?.mode, "payment");
        assert.deepStrictEqual(checkout?.lineItem, {
          _tag: "Amount",
          productId: tip.productId,
          currency: "eur",
          unitAmount: 750,
        });
        assert.deepStrictEqual(checkout?.metadata, {
          kind: "tip",
          productId: tip.productId,
        });
      }),
    );

    it.effect("starts a payment checkout for a preset tip", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        const tip = yield* ensureTip;
        const ada = yield* member();
        yield* commands.startCheckout(ada.subject, {
          kind: "price",
          priceId: tip.presets[0]!.id,
        });
        assert.strictEqual(checkoutCount(fake, ada)[0]?.mode, "payment");
        assert.strictEqual(
          checkoutCount(fake, ada)[0]?.metadata["kind"],
          "tip",
        );
      }),
    );

    it.effect("refuses a recurring price of the tip product", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        yield* ensureTip;
        const queries = yield* PaymentQueries;
        const products = yield* queries.products.pipe(
          asAdmin(yield* member("admin")),
        );
        const tip = products.find((item) => item.kind === "tip")!;
        const monthly = tip.prices.find((price) =>
          Option.isSome(price.recurring),
        )!;
        const ada = yield* member();
        const failure = yield* commands
          .startCheckout(ada.subject, { kind: "price", priceId: monthly.id })
          .pipe(Effect.flip);
        assert.instanceOf(failure, PaymentPriceNotFound);
      }),
    );

    it.effect.each([49, 50_001])(
      "refuses a custom tip of %d outside the bounds",
      (amount) =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          yield* ensureTip;
          const ada = yield* member();
          const failure = yield* commands
            .startCheckout(ada.subject, { kind: "tip", amount })
            .pipe(Effect.flip);
          assert.deepStrictEqual(
            failure,
            new TipAmountOutOfRange({
              minimum: { amount: 100, currency: "eur" },
              maximum: { amount: 50_000, currency: "eur" },
            }),
          );
          assert.lengthOf(checkoutCount(fake, ada), 0);
        }),
    );

    it.effect("accepts the bounds themselves", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        yield* ensureTip;
        const ada = yield* member();
        yield* commands.startCheckout(ada.subject, {
          kind: "tip",
          amount: 100,
        });
        yield* commands.startCheckout(ada.subject, {
          kind: "tip",
          amount: 50_000,
        });
        assert.lengthOf(checkoutCount(fake, ada), 2);
      }),
    );

    it.effect(
      "lets the same product stay the tip product but not a second one",
      () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const tip = yield* ensureTip;
          const admin = yield* member("admin");
          yield* commands
            .updateProduct(tip.productId, { enabled: true, kind: "tip" })
            .pipe(asAdmin(admin));

          const other = yield* t.offer([{ amount: 500 }]);
          const failure = yield* commands
            .updateProduct(other.productId, { enabled: true, kind: "tip" })
            .pipe(asAdmin(admin), Effect.flip);
          assert.instanceOf(failure, ProductKindConflict);
        }),
    );

    it.effect("refuses roles for the tip product", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        const tip = yield* ensureTip;
        const root = yield* member("superAdmin");
        const failure = yield* commands
          .setProductRoles(tip.productId, ["foodPlanner"])
          .pipe(asSuperAdmin(root), Effect.flip);
        assert.instanceOf(failure, ProductKindConflict);
        // No roles at all is fine.
        yield* commands
          .setProductRoles(tip.productId, [])
          .pipe(asSuperAdmin(root));
      }),
    );
  });
});

describe("PaymentCommands without Stripe", () => {
  const fake = makeFakeStripe({ configured: false });

  layer(usersTestWith(fake.layer), { timeout: "30 seconds" })((it) => {
    it.effect("answers PaymentsUnavailable to a checkout", () =>
      Effect.gen(function* () {
        const commands = yield* PaymentCommands;
        const ada = yield* member();
        const failure = yield* commands
          .startCheckout(ada.subject, { kind: "price", priceId: "price_x" })
          .pipe(Effect.flip);
        assert.instanceOf(failure, PaymentsUnavailable);
      }),
    );

    it.effect(
      "answers PaymentsUnavailable to a webhook and a catalog sync",
      () =>
        Effect.gen(function* () {
          const commands = yield* PaymentCommands;
          const { payload, signature } = signed({
            id: fresh("evt"),
            type: "customer.subscription.updated",
            object: { id: "sub_x", object: "subscription" },
          });
          assert.instanceOf(
            yield* commands
              .receiveWebhook(payload, signature)
              .pipe(Effect.flip),
            PaymentsUnavailable,
          );
          const admin = yield* member("admin");
          assert.instanceOf(
            yield* commands.syncCatalog.pipe(asAdmin(admin), Effect.flip),
            PaymentsUnavailable,
          );
        }),
    );

    it.effect("offers nothing", () =>
      Effect.gen(function* () {
        const queries = yield* PaymentQueries;
        assert.deepStrictEqual(yield* queries.catalog, {
          products: [],
          tip: Option.none(),
        });
      }),
    );
  });
});
