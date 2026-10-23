import { assert, describe, it } from "@effect/vitest";
import type {
  PaymentKind,
  PaymentStatus,
  SubscriptionStatus,
} from "@unhalteproblem.de/api";
import { Option } from "effect";
import type { StripePaymentIntent } from "#infrastructure/Stripe";
import {
  entitledRoles,
  monthlyAmount,
  paymentStatusOf,
  purchaseBlocksRepeat,
  purchaseGrantsAccess,
  refundRefusal,
  subscriptionGrantsAccess,
  subscriptionIsLive,
  subscriptionStatusOf,
  sumByCurrency,
} from "./Payment.ts";

const intent = (
  overrides: Partial<StripePaymentIntent> = {},
): StripePaymentIntent => ({
  id: "pi_1",
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

describe("subscriptionStatusOf", () => {
  it.for<readonly [string, SubscriptionStatus]>([
    ["incomplete", "incomplete"],
    ["incomplete_expired", "incompleteExpired"],
    ["trialing", "trialing"],
    ["active", "active"],
    ["past_due", "pastDue"],
    ["canceled", "canceled"],
    ["unpaid", "unpaid"],
    ["paused", "paused"],
  ])("maps Stripe's %s to %s", ([status, expected]) => {
    assert.strictEqual(subscriptionStatusOf(status), expected);
  });

  it.for(["something_new", "", "ACTIVE"])(
    "counts the unknown status %j as incomplete",
    (status) => {
      assert.strictEqual(subscriptionStatusOf(status), "incomplete");
    },
  );
});

describe("subscriptionGrantsAccess", () => {
  it.for<readonly [SubscriptionStatus, boolean]>([
    ["active", true],
    ["trialing", true],
    ["pastDue", false],
    ["incomplete", false],
    ["incompleteExpired", false],
    ["canceled", false],
    ["unpaid", false],
    ["paused", false],
  ])("%s grants access: %s", ([status, expected]) => {
    assert.strictEqual(subscriptionGrantsAccess(status), expected);
  });
});

describe("subscriptionIsLive", () => {
  it.for<readonly [SubscriptionStatus, boolean]>([
    ["active", true],
    ["pastDue", true],
    ["unpaid", true],
    ["paused", true],
    ["incomplete", true],
    ["canceled", false],
    ["incompleteExpired", false],
  ])("%s is live: %s", ([status, expected]) => {
    assert.strictEqual(subscriptionIsLive(status), expected);
  });
});

describe("paymentStatusOf", () => {
  it("is paid for a succeeded intent without refunds", () => {
    assert.strictEqual(paymentStatusOf(intent()), "paid");
  });

  it("is partiallyRefunded when only some of the money came back", () => {
    assert.strictEqual(
      paymentStatusOf(intent({ amountRefunded: 400 })),
      "partiallyRefunded",
    );
  });

  it("is refunded when all of the money came back", () => {
    assert.strictEqual(
      paymentStatusOf(intent({ amountRefunded: 1000 })),
      "refunded",
    );
  });

  it.for(["processing", "requires_action", "requires_confirmation"])(
    "is pending while the intent is %s",
    (status) => {
      assert.strictEqual(paymentStatusOf(intent({ status })), "pending");
    },
  );

  it.for(["requires_payment_method", "canceled", "something_new"])(
    "is failed when the intent is %s",
    (status) => {
      assert.strictEqual(paymentStatusOf(intent({ status })), "failed");
    },
  );

  it.for([
    "needs_response",
    "warning_needs_response",
    "under_review",
    "warning_under_review",
  ])("is disputed while the dispute is %s", (disputeStatus) => {
    assert.strictEqual(
      paymentStatusOf(intent({ disputeStatus: Option.some(disputeStatus) })),
      "disputed",
    );
  });

  it("is disputeLost when the dispute was lost, even if refunded", () => {
    assert.strictEqual(
      paymentStatusOf(
        intent({ disputeStatus: Option.some("lost"), amountRefunded: 1000 }),
      ),
      "disputeLost",
    );
  });

  it.for(["won", "warning_closed", "prevented"])(
    "ignores a dispute that ended as %s",
    (disputeStatus) => {
      assert.strictEqual(
        paymentStatusOf(intent({ disputeStatus: Option.some(disputeStatus) })),
        "paid",
      );
    },
  );
});

describe("purchaseGrantsAccess and purchaseBlocksRepeat", () => {
  it.for<readonly [PaymentStatus, boolean, boolean]>([
    ["paid", true, true],
    ["partiallyRefunded", true, true],
    ["disputed", true, true],
    ["pending", false, true],
    ["refunded", false, false],
    ["disputeLost", false, false],
    ["failed", false, false],
  ])("%s: grants %s, blocks a repeat %s", ([status, grants, blocks]) => {
    assert.strictEqual(purchaseGrantsAccess(status), grants);
    assert.strictEqual(purchaseBlocksRepeat(status), blocks);
  });
});

describe("entitledRoles", () => {
  const rolesOf = (productId: string): ReadonlyArray<string> =>
    ({
      prod_a: ["foodPlanner"],
      prod_b: ["foodPlanner"],
      prod_odd: ["admin", "foodPlanner", "nonsense", "superAdmin"],
      prod_tip: [],
    })[productId] ?? [];

  const subscription = (status: SubscriptionStatus, productId = "prod_a") => ({
    status,
    productId: Option.some(productId),
  });
  const payment = (
    kind: PaymentKind,
    status: PaymentStatus,
    productId = "prod_a",
  ) => ({ kind, status, productId: Option.some(productId) });

  const entitled = (input: {
    subscriptions?: ReadonlyArray<ReturnType<typeof subscription>>;
    payments?: ReadonlyArray<ReturnType<typeof payment>>;
  }) =>
    entitledRoles({
      subscriptions: input.subscriptions ?? [],
      payments: input.payments ?? [],
      rolesOf,
    });

  it("grants nothing without subscriptions and purchases", () => {
    assert.deepStrictEqual(entitled({}), []);
  });

  it("grants the roles of an active subscription", () => {
    assert.deepStrictEqual(
      entitled({ subscriptions: [subscription("active")] }),
      ["foodPlanner"],
    );
    assert.deepStrictEqual(
      entitled({ subscriptions: [subscription("trialing")] }),
      ["foodPlanner"],
    );
  });

  it("grants nothing for a subscription that is past due or ended", () => {
    for (const status of [
      "pastDue",
      "canceled",
      "unpaid",
      "paused",
      "incomplete",
    ] as const) {
      assert.deepStrictEqual(
        entitled({ subscriptions: [subscription(status)] }),
        [],
        status,
      );
    }
  });

  it("grants the roles of a paid purchase, also partly refunded or disputed", () => {
    for (const status of ["paid", "partiallyRefunded", "disputed"] as const) {
      assert.deepStrictEqual(
        entitled({ payments: [payment("purchase", status)] }),
        ["foodPlanner"],
        status,
      );
    }
  });

  it("grants nothing for a refunded, lost, failed or pending purchase", () => {
    for (const status of [
      "refunded",
      "disputeLost",
      "failed",
      "pending",
    ] as const) {
      assert.deepStrictEqual(
        entitled({ payments: [payment("purchase", status)] }),
        [],
        status,
      );
    }
  });

  it("grants nothing for tips and subscription invoices", () => {
    assert.deepStrictEqual(
      entitled({
        payments: [
          payment("tip", "paid", "prod_tip"),
          payment("tip", "paid"),
          payment("subscription", "paid"),
        ],
      }),
      [],
    );
  });

  it("drops roles that are not purchasable and unknown role strings", () => {
    assert.deepStrictEqual(
      entitled({ payments: [payment("purchase", "paid", "prod_odd")] }),
      ["foodPlanner"],
    );
  });

  it("ignores rows without a product", () => {
    assert.deepStrictEqual(
      entitled({
        subscriptions: [{ status: "active", productId: Option.none() }],
        payments: [
          { kind: "purchase", status: "paid", productId: Option.none() },
        ],
      }),
      [],
    );
  });

  it("lists a role once, however many products grant it", () => {
    assert.deepStrictEqual(
      entitled({
        subscriptions: [subscription("active", "prod_a")],
        payments: [
          payment("purchase", "paid", "prod_b"),
          payment("purchase", "paid", "prod_a"),
        ],
      }),
      ["foodPlanner"],
    );
  });
});

describe("refundRefusal", () => {
  const paid = { status: "paid" as const, amount: 1000, amountRefunded: 0 };

  it("allows refunding everything left", () => {
    assert.deepStrictEqual(refundRefusal(paid, Option.none()), Option.none());
  });

  it("allows refunding up to what is left, also after a partial refund", () => {
    assert.deepStrictEqual(
      refundRefusal(paid, Option.some(1000)),
      Option.none(),
    );
    assert.deepStrictEqual(
      refundRefusal(
        { status: "partiallyRefunded", amount: 1000, amountRefunded: 400 },
        Option.some(600),
      ),
      Option.none(),
    );
  });

  it("refuses more than is left", () => {
    assert.deepStrictEqual(
      refundRefusal(paid, Option.some(1001)),
      Option.some("exceedsRemaining"),
    );
    assert.deepStrictEqual(
      refundRefusal(
        { status: "partiallyRefunded", amount: 1000, amountRefunded: 400 },
        Option.some(601),
      ),
      Option.some("exceedsRemaining"),
    );
  });

  it.for<PaymentStatus>([
    "pending",
    "failed",
    "refunded",
    "disputed",
    "disputeLost",
  ])("refuses a payment that is %s as notPaid", (status) => {
    assert.deepStrictEqual(
      refundRefusal({ status, amount: 1000, amountRefunded: 0 }, Option.none()),
      Option.some("notPaid"),
    );
  });

  it("refuses a payment with nothing left as notPaid", () => {
    assert.deepStrictEqual(
      refundRefusal(
        { status: "partiallyRefunded", amount: 1000, amountRefunded: 1000 },
        Option.none(),
      ),
      Option.some("notPaid"),
    );
  });
});

describe("monthlyAmount", () => {
  it("counts a monthly price as is", () => {
    assert.strictEqual(monthlyAmount(500, "month", 1), 500);
  });

  it("counts a twelfth of a yearly price", () => {
    assert.strictEqual(monthlyAmount(12_000, "year", 1), 1000);
  });

  it("counts 52/12 weeks per month", () => {
    assert.closeTo(monthlyAmount(1200, "week", 1), 5200, 1e-9);
  });

  it("counts a day as 365/12 per month", () => {
    assert.closeTo(monthlyAmount(100, "day", 1), (100 * 365) / 12, 1e-9);
  });

  it("divides by the interval count", () => {
    assert.strictEqual(monthlyAmount(3000, "month", 3), 1000);
    assert.strictEqual(monthlyAmount(24_000, "year", 2), 1000);
    assert.closeTo(monthlyAmount(2400, "week", 2), 5200, 1e-9);
  });
});

describe("sumByCurrency", () => {
  it("is empty without amounts", () => {
    assert.deepStrictEqual(sumByCurrency([]), []);
  });

  it("sums per currency and sorts by currency", () => {
    assert.deepStrictEqual(
      sumByCurrency([
        { amount: 500, currency: "usd" },
        { amount: 100, currency: "eur" },
        { amount: 250, currency: "eur" },
      ]),
      [
        { currency: "eur", amount: 350 },
        { currency: "usd", amount: 500 },
      ],
    );
  });

  it("rounds each sum, not each amount", () => {
    assert.deepStrictEqual(
      sumByCurrency([
        { amount: 0.4, currency: "eur" },
        { amount: 0.4, currency: "eur" },
        { amount: 0.4, currency: "eur" },
      ]),
      [{ currency: "eur", amount: 1 }],
    );
  });
});
