import {
  AlreadyEntitled,
  Authorized,
  type CheckoutRequest,
  InvalidWebhookSignature,
  PaymentCustomerNotFound,
  PaymentNotFound,
  PaymentPriceNotFound,
  PaymentProductNotFound,
  PaymentProviderFailed,
  PaymentsUnavailable,
  type PaymentId,
  type ProductCredit,
  ProductKindConflict,
  type PurchasableRole,
  type RedirectUrl,
  RefundNotAllowed,
  TipAmountOutOfRange,
  TipsUnavailable,
  type UpdatePaymentProductPayload,
} from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import {
  Array as Arr,
  Context,
  DateTime,
  type Duration,
  Effect,
  Layer,
  Option,
} from "effect";
import { PaymentsConfig, PublicUrlConfig } from "#Config";
import * as Command from "#cqrs/Command";
import { Outbox } from "#cqrs/Outbox";
import * as Query from "#cqrs/Query";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import {
  changedOffers,
  offerAt,
  rolesOfFeatures,
} from "#domains/credits/Credit";
import { CreditCommands } from "#domains/credits/CreditCommands";
import { CreditQueries } from "#domains/credits/CreditQueries";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { isUniqueViolation } from "#infrastructure/Columns";
import type { User, UserId } from "#domains/users/User";
import {
  Stripe,
  type StripeEventRefs,
  StripeFailed,
  type StripeLineItem,
  type StripeProduct,
} from "#infrastructure/Stripe";
import {
  CheckoutMetadata,
  entitledRoles,
  fromStripeTime,
  paymentStatusOf,
  purchaseBlocksRepeat,
  purchaseGrantsAccess,
  refundRefusal,
  subscriptionIsLive,
  subscriptionStatusOf,
} from "./Payment.ts";
import { PaymentRepository } from "./PaymentRepository.ts";
import {
  CancelCustomerSubscriptions,
  HandleStripeEvent,
} from "./StripeTopics.ts";

const providerFailed = (error: StripeFailed) =>
  error.reason === "unconfigured"
    ? new PaymentsUnavailable()
    : new PaymentProviderFailed({ reason: error.reason });

const make = Effect.gen(function* () {
  const repository = yield* PaymentRepository;
  const stripe = yield* Stripe;
  const users = yield* UserDirectory;
  const moderation = yield* ModerationCommands;
  const moderationQueries = yield* ModerationQueries;
  const credits = yield* CreditCommands;
  const creditQueries = yield* CreditQueries;
  const audit = yield* AuditCommands;
  const outbox = yield* Outbox;
  const transaction = yield* Transaction;
  const settings = yield* PaymentsConfig;
  const { origin } = yield* PublicUrlConfig;
  const livemode = stripe.livemode;

  // Where Stripe sends the browser back to. The account page reads the
  // `checkout` parameter to say how it went.
  const accountUrl = `${origin}/account`;

  const requireConfigured = stripe.configured
    ? Effect.void
    : Effect.fail(new PaymentsUnavailable());

  const userOf = Effect.fnUntraced(function* (subject: typeof Subject.Type) {
    const user = yield* users.findBySubject(subject).pipe(Query.boundary);
    // Every session belongs to a user, and a deleted one has no session.
    if (Option.isNone(user) || Option.isSome(user.value.deletedAt)) {
      return yield* Effect.die(new Error("Paying user without a users row"));
    }
    return user.value;
  });

  // Our id of the admin behind a proof, for the audit log.
  const actorOf = (proof: { readonly user: { readonly id: string } }) =>
    actorIdOf(proof).pipe(
      Effect.provideService(UserDirectory, users),
      Query.boundary,
    );

  // Roles

  /**
   * Recomputes what the user holds through payments from the mirrored
   * subscriptions and purchases: hands their one-off purchases to credits,
   * and the roles (those of the products, and those that come with the
   * credits they hold) to moderation. Joins the caller's transaction.
   */
  const syncRolesOf = Effect.fnUntraced(function* (userId: UserId) {
    // First, so that what is read below is what the sync acts on: two
    // syncs of the same user (a webhook and a product change) take turns.
    yield* users.lockForUpdate([userId]);
    const subscriptions = yield* repository.subscriptionsOfUser(
      userId,
      livemode,
    );
    const payments = yield* repository.paymentsOfUser(userId, livemode);
    const productIds = Arr.getSomes([
      ...subscriptions.map((row) => row.productId),
      ...payments.map((row) => row.productId),
    ]);
    const roles = yield* repository.rolesOf(productIds);
    const offers = yield* repository.creditsOf(productIds);
    const features = yield* credits.syncPaidCredits(
      userId,
      payments
        .filter((row) => row.kind === "purchase")
        .map((row) => ({
          paymentId: row.id,
          grantsAccess: purchaseGrantsAccess(row.status),
          createdAt: row.createdAt,
          offers: Option.match(row.productId, {
            onNone: () => [],
            onSome: (productId) => offers.get(productId) ?? [],
          }),
        })),
    );
    yield* moderation.syncPaidRoles(userId, [
      ...entitledRoles({
        subscriptions,
        payments,
        rolesOf: (productId) => roles.get(productId) ?? [],
      }),
      ...rolesOfFeatures(features),
    ]);
  });

  /** What one purchase of the product grants now (its newest versions). */
  const currentCreditsOf = Effect.fnUntraced(function* (productId: string) {
    const versions = yield* repository.creditsOf([productId]);
    return offerAt(versions.get(productId) ?? [], yield* DateTime.now);
  });

  // Mirroring Stripe. Every sync fetches the current state of an object, so
  // a repeated or late webhook changes nothing that a newer one changed.

  const storeProduct = Effect.fnUntraced(function* (product: StripeProduct) {
    const now = yield* DateTime.now;
    yield* repository.upsertProduct({ ...product, updatedAt: now });
    for (const price of product.prices) {
      yield* repository.upsertPrice({
        id: price.id,
        productId: product.id,
        active: price.active,
        currency: price.currency,
        unitAmount: price.unitAmount,
        recurringInterval: Option.flatMap(price.recurring, (recurring) =>
          isInterval(recurring.interval)
            ? Option.some(recurring.interval)
            : Option.none(),
        ),
        recurringIntervalCount: Option.flatMap(price.recurring, (recurring) =>
          isInterval(recurring.interval)
            ? Option.some(recurring.intervalCount)
            : Option.none(),
        ),
        livemode: price.livemode,
        updatedAt: now,
      });
    }
  });

  const syncProduct = Effect.fn("PaymentCommands.syncProduct")(function* (
    id: string,
  ) {
    const product = yield* stripe.product(id);
    yield* Effect.gen(function* () {
      if (Option.isNone(product)) {
        yield* repository.deactivateProduct(id, yield* DateTime.now);
      } else if (product.value.livemode === livemode) {
        yield* storeProduct(product.value);
      }
    }).pipe(Command.boundary(transaction));
  });

  const syncSubscription = Effect.fn("PaymentCommands.syncSubscription")(
    function* (id: string) {
      const found = yield* stripe.subscription(id);
      if (Option.isNone(found) || found.value.livemode !== livemode) return;
      const subscription = found.value;
      if (
        Option.isSome(subscription.productId) &&
        Option.isNone(
          yield* repository
            .findProduct(subscription.productId.value)
            .pipe(Query.boundary),
        )
      ) {
        yield* syncProduct(subscription.productId.value);
      }
      yield* Effect.gen(function* () {
        // Whose it is, by the customer we made for them: never by metadata.
        const userId = yield* repository.userOfCustomer(
          subscription.customerId,
        );
        yield* repository.upsertSubscription({
          id: subscription.id,
          userId,
          customerId: subscription.customerId,
          productId: subscription.productId,
          priceId: subscription.priceId,
          status: subscriptionStatusOf(subscription.status),
          currentPeriodEnd: Option.map(
            subscription.currentPeriodEnd,
            fromStripeTime,
          ),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          canceledAt: Option.map(subscription.canceledAt, fromStripeTime),
          livemode: subscription.livemode,
          createdAt: fromStripeTime(subscription.created),
          updatedAt: yield* DateTime.now,
        });
        if (Option.isSome(userId)) yield* syncRolesOf(userId.value);
      }).pipe(Command.boundary(transaction));
    },
  );

  const intentState = Effect.fnUntraced(function* (
    paymentIntentId: Option.Option<string>,
  ) {
    if (Option.isNone(paymentIntentId)) return Option.none();
    const intent = yield* stripe.paymentIntent(paymentIntentId.value);
    return Option.map(intent, (value) => ({
      status: paymentStatusOf(value),
      amountRefunded: value.amountRefunded,
    }));
  });

  const syncCheckoutSession = Effect.fn("PaymentCommands.syncCheckoutSession")(
    function* (id: string) {
      const found = yield* stripe.checkoutSession(id);
      if (Option.isNone(found) || found.value.livemode !== livemode) return;
      const session = found.value;
      if (session.mode === "subscription") {
        if (Option.isSome(session.subscriptionId)) {
          yield* syncSubscription(session.subscriptionId.value);
        }
        return;
      }
      // Open or expired sessions took no money.
      if (
        session.mode !== "payment" ||
        !Option.contains(session.status, "complete")
      ) {
        return;
      }
      // What was bought is what Stripe charged for (the line item), never
      // what the session's metadata claims.
      if (Option.isNone(session.productId)) {
        yield* Effect.logWarning(
          "Ignoring a checkout session without a product",
        );
        return;
      }
      const productId = session.productId.value;
      if (
        Option.isNone(
          yield* repository.findProduct(productId).pipe(Query.boundary),
        )
      ) {
        yield* syncProduct(productId);
      }
      const state = yield* intentState(session.paymentIntentId);
      const now = yield* DateTime.now;
      yield* Effect.gen(function* () {
        const userId = Option.isSome(session.customerId)
          ? yield* repository.userOfCustomer(session.customerId.value)
          : Option.none();
        const product = yield* repository.findProduct(productId);
        yield* repository.upsertPayment({
          id: crypto.randomUUID() as PaymentId,
          userId,
          kind: Option.exists(product, (row) => row.kind === "tip")
            ? "tip"
            : "purchase",
          productId: Option.some(productId),
          checkoutSessionId: Option.some(session.id),
          invoiceId: Option.none(),
          subscriptionId: Option.none(),
          paymentIntentId: session.paymentIntentId,
          amount: Option.getOrElse(session.amountTotal, () => 0),
          amountRefunded: Option.match(state, {
            onNone: () => 0,
            onSome: ({ amountRefunded }) => amountRefunded,
          }),
          currency: Option.getOrElse(
            session.currency,
            () => settings.tipCurrency,
          ),
          // Without a payment intent nothing was charged (a 100 % coupon).
          status: Option.match(state, {
            onNone: () =>
              session.paymentStatus === "unpaid" ? "pending" : "paid",
            onSome: ({ status }) => status,
          }),
          livemode: session.livemode,
          createdAt: fromStripeTime(session.created),
          updatedAt: now,
        });
        if (Option.isSome(userId)) yield* syncRolesOf(userId.value);
      }).pipe(Command.boundary(transaction));
    },
  );

  const syncInvoice = Effect.fn("PaymentCommands.syncInvoice")(function* (
    id: string,
  ) {
    const found = yield* stripe.invoice(id);
    if (Option.isNone(found) || found.value.livemode !== livemode) return;
    const invoice = found.value;
    // Invoices of one-off payments (`STRIPE_CHECKOUT_INVOICES`) or sent by
    // hand are no subscription payments: the checkout session records the
    // former, the latter are not ours.
    if (Option.isNone(invoice.subscriptionId)) return;
    // The subscription's status decides about the roles, so it comes first.
    yield* syncSubscription(invoice.subscriptionId.value);
    // Only money received is a payment; a failed attempt shows in the
    // subscription's status, a free invoice (a trial) is no payment.
    if (!Option.contains(invoice.status, "paid") || invoice.amountPaid <= 0) {
      return;
    }
    const state = yield* intentState(invoice.paymentIntentId);
    const now = yield* DateTime.now;
    yield* Effect.gen(function* () {
      const subscription = Option.isSome(invoice.subscriptionId)
        ? yield* repository.findSubscription(invoice.subscriptionId.value)
        : Option.none();
      const userId = Option.isSome(invoice.customerId)
        ? yield* repository.userOfCustomer(invoice.customerId.value)
        : Option.none();
      yield* repository.upsertPayment({
        id: crypto.randomUUID() as PaymentId,
        userId,
        kind: "subscription",
        productId: Option.flatMap(subscription, (row) => row.productId),
        checkoutSessionId: Option.none(),
        invoiceId: Option.some(invoice.id),
        subscriptionId: invoice.subscriptionId,
        paymentIntentId: invoice.paymentIntentId,
        amount: invoice.amountPaid,
        amountRefunded: Option.match(state, {
          onNone: () => 0,
          onSome: ({ amountRefunded }) => amountRefunded,
        }),
        currency: invoice.currency,
        status: Option.match(state, {
          onNone: () => "paid" as const,
          onSome: ({ status }) => status,
        }),
        livemode: invoice.livemode,
        createdAt: fromStripeTime(invoice.created),
        updatedAt: now,
      });
    }).pipe(Command.boundary(transaction));
  });

  const syncPaymentIntent = Effect.fn("PaymentCommands.syncPaymentIntent")(
    function* (id: string) {
      const found = yield* stripe.paymentIntent(id);
      if (Option.isNone(found) || found.value.livemode !== livemode) return;
      const intent = found.value;
      yield* Effect.gen(function* () {
        const owners = yield* repository.updateIntentState({
          paymentIntentId: intent.id,
          status: paymentStatusOf(intent),
          amountRefunded: intent.amountRefunded,
          updatedAt: yield* DateTime.now,
        });
        for (const userId of new Set(owners)) yield* syncRolesOf(userId);
      }).pipe(Command.boundary(transaction));
    },
  );

  // Checkout

  /** What a checkout request buys, or why it can't be bought. */
  const planCheckout = Effect.fnUntraced(function* (
    user: User,
    request: CheckoutRequest,
  ) {
    if (request.kind === "tip") {
      const tip = yield* repository.findTipProduct(livemode);
      if (Option.isNone(tip) || !tip.value.enabled || !tip.value.active) {
        return yield* new TipsUnavailable();
      }
      if (
        request.amount < settings.tipMinimum ||
        request.amount > settings.tipMaximum
      ) {
        return yield* new TipAmountOutOfRange({
          minimum: {
            amount: settings.tipMinimum,
            currency: settings.tipCurrency,
          },
          maximum: {
            amount: settings.tipMaximum,
            currency: settings.tipCurrency,
          },
        });
      }
      return {
        mode: "payment" as const,
        kind: "tip" as const,
        productId: tip.value.id,
        lineItem: {
          _tag: "Amount",
          productId: tip.value.id,
          currency: settings.tipCurrency,
          unitAmount: request.amount,
        } satisfies StripeLineItem,
      };
    }
    const notOffered = new PaymentPriceNotFound({ price: request.priceId });
    const price = yield* repository.findPrice(request.priceId);
    if (
      Option.isNone(price) ||
      !price.value.active ||
      price.value.livemode !== livemode ||
      Option.isNone(price.value.unitAmount)
    ) {
      return yield* notOffered;
    }
    const product = yield* repository.findProduct(price.value.productId);
    if (
      Option.isNone(product) ||
      !product.value.enabled ||
      !product.value.active
    ) {
      return yield* notOffered;
    }
    const recurring = Option.isSome(price.value.recurringInterval);
    const lineItem = {
      _tag: "Price",
      priceId: price.value.id,
    } satisfies StripeLineItem;
    if (product.value.kind === "tip") {
      // A preset tip; a recurring one would be a subscription to nothing.
      if (recurring) return yield* notOffered;
      return {
        mode: "payment" as const,
        kind: "tip" as const,
        productId: product.value.id,
        lineItem,
      };
    }
    if (recurring) {
      const subscriptions = yield* repository.subscriptionsOfUser(
        user.id,
        livemode,
      );
      if (
        subscriptions.some(
          (row) =>
            Option.contains(row.productId, product.value.id) &&
            subscriptionIsLive(row.status),
        )
      ) {
        return yield* new AlreadyEntitled({
          product: product.value.id,
          reason: "subscribed",
        });
      }
      return {
        mode: "subscription" as const,
        kind: "subscription" as const,
        productId: product.value.id,
        lineItem,
      };
    }
    // Credits are used up, so a product that grants them is bought again
    // and again.
    const repeatable = (yield* currentCreditsOf(product.value.id)).length > 0;
    const payments = yield* repository.paymentsOfUser(user.id, livemode);
    if (
      !repeatable &&
      payments.some(
        (row) =>
          row.kind === "purchase" &&
          Option.contains(row.productId, product.value.id) &&
          purchaseBlocksRepeat(row.status),
      )
    ) {
      return yield* new AlreadyEntitled({
        product: product.value.id,
        reason: "purchased",
      });
    }
    return {
      mode: "payment" as const,
      kind: "purchase" as const,
      productId: product.value.id,
      lineItem,
    };
  });

  /** The user's Stripe customer in the current mode, made on first use. */
  const customerOf = Effect.fnUntraced(function* (user: User) {
    const existing = yield* repository
      .customerOf(user.id, livemode)
      .pipe(Query.boundary);
    if (Option.isSome(existing)) return existing.value;
    const customerId = yield* stripe.createCustomer({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    // Two checkouts at once make the same customer (idempotency key); if
    // one stored another, theirs wins and this one stays unused.
    return yield* Effect.gen(function* () {
      yield* repository.insertCustomer({
        userId: user.id,
        livemode,
        customerId,
        createdAt: yield* DateTime.now,
      });
      return Option.getOrElse(
        yield* repository.customerOf(user.id, livemode),
        () => customerId,
      );
    }).pipe(Command.boundary(transaction));
  });

  return PaymentCommands.of({
    startCheckout: Effect.fn("PaymentCommands.startCheckout")(function* (
      subject: typeof Subject.Type,
      request: CheckoutRequest,
    ) {
      yield* requireConfigured;
      const user = yield* userOf(subject);
      const plan = yield* planCheckout(user, request).pipe(Query.boundary);
      const metadata: CheckoutMetadata = {
        kind: plan.kind,
        productId: plan.productId,
      };
      const session = yield* Effect.gen(function* () {
        const customerId = yield* customerOf(user);
        return yield* stripe.createCheckoutSession({
          customerId,
          mode: plan.mode,
          lineItem: plan.lineItem,
          successUrl: `${accountUrl}?checkout=success`,
          cancelUrl: `${accountUrl}?checkout=cancelled`,
          userId: user.id,
          metadata: { ...metadata },
        });
      }).pipe(Effect.mapError(providerFailed));
      return { url: session.url } satisfies RedirectUrl;
    }),

    openBillingPortal: Effect.fn("PaymentCommands.openBillingPortal")(
      function* (subject: typeof Subject.Type) {
        yield* requireConfigured;
        const user = yield* userOf(subject);
        const customerId = yield* repository
          .customerOf(user.id, livemode)
          .pipe(Query.boundary);
        if (Option.isNone(customerId)) {
          return yield* new PaymentCustomerNotFound();
        }
        const url = yield* stripe
          .createPortalSession({
            customerId: customerId.value,
            returnUrl: accountUrl,
          })
          .pipe(Effect.mapError(providerFailed));
        return { url } satisfies RedirectUrl;
      },
    ),

    refund: Effect.fn("PaymentCommands.refund")(function* (
      paymentId: PaymentId,
      amount: Option.Option<number>,
    ) {
      const proof = yield* Authorized("admin");
      yield* requireConfigured;
      const actor = yield* actorOf(proof);
      // Checked first, then refunded outside any transaction: Stripe may take
      // a while, and no lock or connection should wait for it. Two admins
      // refunding the rest at once both pass the check; Stripe refuses the
      // second (more than is left), which answers 502.
      const { row, paymentIntentId } = yield* Effect.gen(function* () {
        const found = yield* repository.findPayment(paymentId);
        if (Option.isNone(found) || found.value.livemode !== livemode) {
          return yield* new PaymentNotFound({ payment: paymentId });
        }
        const row = found.value;
        const refusal = refundRefusal(row, amount);
        if (Option.isSome(refusal) || Option.isNone(row.paymentIntentId)) {
          return yield* new RefundNotAllowed({
            reason: Option.getOrElse(refusal, () => "notPaid" as const),
          });
        }
        return { row, paymentIntentId: row.paymentIntentId.value };
      }).pipe(Query.boundary);
      yield* stripe
        .refund({
          paymentIntentId,
          amount,
          // A double click, or a retry after a timeout, refunds once.
          idempotencyKey: `refund-${row.id}-${row.amountRefunded}-${Option.getOrElse(amount, () => "rest")}`,
        })
        .pipe(Effect.mapError(providerFailed));
      yield* audit.record({
        action: "payment_refunded",
        actor: Option.some(actor),
        target: row.userId,
        detail: row.id,
      });
      // The webhook brings the same news; this makes the answer current. The
      // refund happened either way, so a failure here is only logged.
      yield* syncPaymentIntent(paymentIntentId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Mirroring a refund failed", cause),
        ),
      );
    }),

    syncCatalog: Effect.gen(function* () {
      const proof = yield* Authorized("admin");
      yield* requireConfigured;
      const actor = yield* actorOf(proof);
      const products = yield* stripe.products.pipe(
        Effect.mapError(providerFailed),
      );
      yield* Effect.gen(function* () {
        const now = yield* DateTime.now;
        const seen = new Set<string>();
        for (const product of products) {
          if (product.livemode !== livemode) continue;
          seen.add(product.id);
          yield* storeProduct(product);
        }
        // Deleted in Stripe since: no longer offered.
        for (const row of yield* repository.products(livemode)) {
          if (!seen.has(row.id) && row.active) {
            yield* repository.deactivateProduct(row.id, now);
          }
        }
        yield* audit.record({
          action: "payment_catalog_synced",
          actor: Option.some(actor),
          target: Option.none(),
        });
      }).pipe(Command.boundary(transaction));
    }).pipe(Effect.withSpan("PaymentCommands.syncCatalog")),

    updateProduct: Effect.fn("PaymentCommands.updateProduct")(function* (
      productId: string,
      update: UpdatePaymentProductPayload,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      const product = yield* repository.findProductForUpdate(productId);
      if (Option.isNone(product) || product.value.livemode !== livemode) {
        return yield* new PaymentProductNotFound({ product: productId });
      }
      if (update.kind === "tip") {
        const tip = yield* repository.findTipProduct(livemode);
        const roles = yield* repository.rolesOf([productId]);
        const credits = yield* currentCreditsOf(productId);
        if (
          (Option.isSome(tip) && tip.value.id !== productId) ||
          roles.has(productId) ||
          credits.length > 0
        ) {
          return yield* new ProductKindConflict();
        }
      }
      const updatedAt = yield* DateTime.now;
      // A savepoint: two admins making two products the tip product at once
      // both pass the check above, and the database refuses the second.
      yield* transaction
        .run(
          repository.updateProductSettings({
            id: productId,
            enabled: update.enabled,
            kind: update.kind,
            updatedAt,
          }),
        )
        .pipe(
          Effect.catchIf(
            isUniqueViolation("payment_products_livemode_tip_key"),
            () => Effect.fail(new ProductKindConflict()),
          ),
        );
      yield* audit.record({
        action: "payment_product_updated",
        actor: Option.some(actor),
        target: Option.none(),
        detail: productId,
      });
    }, Command.boundary(transaction)),

    setProductRoles: Effect.fn("PaymentCommands.setProductRoles")(function* (
      productId: string,
      roles: ReadonlyArray<PurchasableRole>,
    ) {
      const actor = yield* actorOf(yield* Authorized("superAdmin"));
      const product = yield* repository.findProductForUpdate(productId);
      if (Option.isNone(product) || product.value.livemode !== livemode) {
        return yield* new PaymentProductNotFound({ product: productId });
      }
      // A tip buys nothing, and a product grants roles or credits, not both.
      if (
        roles.length > 0 &&
        (product.value.kind === "tip" ||
          (yield* currentCreditsOf(productId)).length > 0)
      ) {
        return yield* new ProductKindConflict();
      }
      yield* repository.setProductRoles(productId, [...new Set(roles)]);
      yield* audit.record({
        action: "payment_product_roles_changed",
        actor: Option.some(actor),
        target: Option.none(),
        detail: productId,
      });
      // Everyone who paid for it holds the new roles from now on.
      for (const userId of yield* repository.usersOfProduct(productId)) {
        yield* syncRolesOf(userId);
      }
    }, Command.boundary(transaction)),

    setProductCredits: Effect.fn("PaymentCommands.setProductCredits")(
      function* (productId: string, offered: ReadonlyArray<ProductCredit>) {
        const actor = yield* actorOf(yield* Authorized("superAdmin"));
        const product = yield* repository.findProductForUpdate(productId);
        if (Option.isNone(product) || product.value.livemode !== livemode) {
          return yield* new PaymentProductNotFound({ product: productId });
        }
        // A tip buys nothing, and a product grants roles or credits, not both.
        if (
          offered.length > 0 &&
          (product.value.kind === "tip" ||
            (yield* repository.rolesOf([productId])).has(productId))
        ) {
          return yield* new ProductKindConflict();
        }
        // A new version for each feature that changes: purchases started from
        // now on get it, those started before keep theirs (see
        // creditsOfPurchase), so nobody is resynced.
        const now = yield* DateTime.now;
        yield* repository.addCreditVersions(
          productId,
          changedOffers(yield* currentCreditsOf(productId), offered),
          now,
        );
        yield* audit.record({
          action: "payment_product_credits_changed",
          actor: Option.some(actor),
          target: Option.none(),
          detail: productId,
        });
      },
      Command.boundary(transaction),
    ),

    receiveWebhook: Effect.fn("PaymentCommands.receiveWebhook")(function* (
      payload: string,
      signature: string,
    ) {
      const event = yield* stripe.verifyWebhook(payload, signature).pipe(
        Effect.catchTags({
          StripeSignatureInvalid: () =>
            Effect.fail(new InvalidWebhookSignature()),
          StripeFailed: () => Effect.fail(new PaymentsUnavailable()),
        }),
      );
      // A test event at a live endpoint (or the reverse) is not ours.
      if (event.livemode !== livemode) {
        yield* Effect.logWarning("Ignoring a Stripe event of the other mode");
        return;
      }
      yield* Effect.gen(function* () {
        const fresh = yield* repository.recordEvent({
          id: event.id,
          type: event.type,
          livemode: event.livemode,
          receivedAt: yield* DateTime.now,
        });
        // Stripe delivers at least once; a repeat is acknowledged and dropped.
        if (fresh) {
          yield* outbox.enqueue(HandleStripeEvent, {
            eventId: event.id,
            type: event.type,
            refs: event.refs,
          });
        }
      }).pipe(Command.boundary(transaction));
    }),

    handleEvent: Effect.fn("PaymentCommands.handleEvent")(function* (event: {
      readonly eventId: string;
      readonly type: string;
      readonly refs: StripeEventRefs;
    }) {
      yield* Effect.annotateCurrentSpan({ type: event.type });
      const { refs } = event;
      if (refs.productId !== undefined) yield* syncProduct(refs.productId);
      if (refs.checkoutSessionId !== undefined) {
        yield* syncCheckoutSession(refs.checkoutSessionId);
      }
      if (refs.subscriptionId !== undefined) {
        yield* syncSubscription(refs.subscriptionId);
      }
      if (refs.invoiceId !== undefined) yield* syncInvoice(refs.invoiceId);
      if (refs.paymentIntentId !== undefined) {
        yield* syncPaymentIntent(refs.paymentIntentId);
      }
    }),

    cancelSubscriptionsOf: Effect.fn("PaymentCommands.cancelSubscriptionsOf")(
      function* (customerId: string) {
        const subscriptions = yield* stripe.subscriptionsOfCustomer(customerId);
        for (const subscription of subscriptions) {
          if (subscriptionIsLive(subscriptionStatusOf(subscription.status))) {
            yield* stripe.cancelSubscription(subscription.id);
          }
        }
      },
    ),

    resyncPaidRoles: Effect.gen(function* () {
      // Without Stripe the current mode is unknown: leave every grant alone.
      if (!stripe.configured) return 0;
      // Credits too: a superAdmin may have revoked a credit's role by hand.
      const holders = [
        ...new Set([
          ...(yield* moderationQueries.paidRoleHolders),
          ...(yield* creditQueries.holders),
        ]),
      ];
      for (const userId of holders) {
        yield* syncRolesOf(userId).pipe(Command.boundary(transaction));
      }
      return holders.length;
    }).pipe(Effect.withSpan("PaymentCommands.resyncPaidRoles")),

    purgeEventsOlderThan: Effect.fn("PaymentCommands.purgeEventsOlderThan")(
      function* (retention: Duration.Input) {
        const now = yield* DateTime.now;
        return yield* repository.deleteEventsReceivedBefore(
          DateTime.subtractDuration(now, retention),
        );
      },
      Command.boundary(transaction),
    ),

    releaseCustomer: Effect.fn("PaymentCommands.releaseCustomer")(function* (
      userId: UserId,
    ) {
      // The current mode only: a test customer's subscriptions charge
      // nobody, and the current key can't reach the other mode anyway.
      yield* credits.revokeAllOf(userId);
      const customerId = yield* repository.customerOf(userId, livemode);
      if (Option.isSome(customerId)) {
        yield* outbox.enqueue(CancelCustomerSubscriptions, {
          customerId: customerId.value,
        });
      }
    }, Command.boundary(transaction)),
  });
});

const intervals = new Set(["day", "week", "month", "year"]);
const isInterval = (
  interval: string,
): interval is "day" | "week" | "month" | "year" => intervals.has(interval);

/**
 * The commands of the payments domain: starting a Stripe Checkout or the
 * customer portal for the logged-in user, refunds and catalog settings for
 * admins (product roles for superAdmins), and mirroring Stripe after each
 * webhook, which also grants and revokes the roles and credits payments
 * entitle users to (through `ModerationCommands.syncPaidRoles` and
 * `CreditCommands.syncPaidCredits`).
 */
export class PaymentCommands extends Context.Service<
  PaymentCommands,
  {
    /**
     * A Checkout session for the user with this `sub`: a price of an
     * offered product (a subscription, a one-off purchase or a preset tip)
     * or a custom tip. Refused for a product they already subscribe to or
     * bought, unless it grants credits. Makes their Stripe customer on first
     * use.
     */
    readonly startCheckout: (
      subject: typeof Subject.Type,
      request: CheckoutRequest,
    ) => Effect.Effect<
      RedirectUrl,
      | PaymentsUnavailable
      | PaymentProviderFailed
      | PaymentPriceNotFound
      | AlreadyEntitled
      | TipAmountOutOfRange
      | TipsUnavailable
    >;
    /** Stripe's customer portal for the user's own customer. */
    readonly openBillingPortal: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<
      RedirectUrl,
      PaymentsUnavailable | PaymentProviderFailed | PaymentCustomerNotFound
    >;
    /**
     * Refunds `amount` (None: all that is left) of a paid payment (admins
     * only), audited, and mirrors the result at once.
     */
    readonly refund: (
      paymentId: PaymentId,
      amount: Option.Option<number>,
    ) => Effect.Effect<
      void,
      | PaymentNotFound
      | RefundNotAllowed
      | PaymentsUnavailable
      | PaymentProviderFailed,
      Authorized<"admin">
    >;
    /** Pulls the whole catalog from Stripe now (admins only). */
    readonly syncCatalog: Effect.Effect<
      void,
      PaymentsUnavailable | PaymentProviderFailed,
      Authorized<"admin">
    >;
    /**
     * Whether a product is offered and whether it is the tip product
     * (admins only). There is one tip product, and it grants no roles.
     */
    readonly updateProduct: (
      productId: string,
      update: UpdatePaymentProductPayload,
    ) => Effect.Effect<
      void,
      PaymentProductNotFound | ProductKindConflict,
      Authorized<"admin">
    >;
    /**
     * Which roles a product grants (superAdmins only, as it grants roles),
     * applied at once to everyone who paid for it.
     */
    readonly setProductRoles: (
      productId: string,
      roles: ReadonlyArray<PurchasableRole>,
    ) => Effect.Effect<
      void,
      PaymentProductNotFound | ProductKindConflict,
      Authorized<"superAdmin">
    >;
    /**
     * Which credits one purchase of a product grants (superAdmins only, as
     * credits come with roles). Applies to purchases made from now on;
     * earlier ones keep the credits they got.
     */
    readonly setProductCredits: (
      productId: string,
      credits: ReadonlyArray<ProductCredit>,
    ) => Effect.Effect<
      void,
      PaymentProductNotFound | ProductKindConflict,
      Authorized<"superAdmin">
    >;
    /**
     * A webhook delivery: checks its signature, remembers the event and
     * queues it for `handleEvent` (`payments.stripe-event`), in one
     * transaction. A repeated delivery is acknowledged and dropped.
     */
    readonly receiveWebhook: (
      payload: string,
      signature: string,
    ) => Effect.Effect<void, InvalidWebhookSignature | PaymentsUnavailable>;
    /** Mirrors what an event is about from Stripe (the outbox consumer). */
    readonly handleEvent: (event: {
      readonly eventId: string;
      readonly type: string;
      readonly refs: StripeEventRefs;
    }) => Effect.Effect<void, StripeFailed>;
    /** Cancels a customer's live subscriptions now (the outbox consumer). */
    readonly cancelSubscriptionsOf: (
      customerId: string,
    ) => Effect.Effect<void, StripeFailed>;
    /**
     * Checks everyone who holds a role or credits through a payment against
     * the current mode's subscriptions and purchases (at startup): a switch from
     * the test key to the live one takes away what test payments granted.
     * Does nothing while Stripe is not configured. Returns how many users
     * it checked.
     */
    readonly resyncPaidRoles: Effect.Effect<number>;
    /** Forgets webhook event ids older than `retention`; returns how many. */
    readonly purgeEventsOlderThan: (
      retention: Duration.Input,
    ) => Effect.Effect<number>;
    /**
     * For `UserCommands.deleteAccount`, in its transaction: revokes the
     * user's credits and queues the cancellation of their subscriptions.
     * Their payments stay, as records of the business (tied to the
     * anonymised account).
     */
    readonly releaseCustomer: (userId: UserId) => Effect.Effect<void>;
  }
>()("@unhalteproblem.de/backend/domains/payments/PaymentCommands") {
  /**
   * Needs `PaymentRepository`, `Stripe`, `UserDirectory`,
   * `ModerationCommands`, `ModerationQueries`, `CreditCommands`,
   * `CreditQueries`, `AuditCommands`, `Outbox` and `Transaction`.
   */
  static readonly layer = Layer.effect(PaymentCommands, make);
}
