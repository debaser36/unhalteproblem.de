import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Option, Schema } from "effect";
import { Role } from "./Auth.ts";
import {
  AdminPaymentQuery,
  Catalog,
  CheckoutRequest,
  Currency,
  Payment,
  PaymentCursor,
  PaymentId,
  PaymentMoney,
  PurchasableRole,
  RefundPayload,
  SetPaymentProductRolesPayload,
  StripePriceId,
  StripeProductId,
  StripeSubscriptionId,
  SubscriptionCursor,
} from "./Payment.ts";

const succeeds = <S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const paymentId = "6a1f3c2e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";
const userId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";
const at = "2026-03-01T12:00:00.000Z";

describe("PurchasableRole", () => {
  it("is a subset of the roles", () => {
    for (const role of PurchasableRole.literals) {
      assert.isTrue(succeeds(Role, role), role);
    }
  });

  it.each(["foodPlanner"])("accepts %s", (role) => {
    assert.isTrue(succeeds(PurchasableRole, role));
  });

  it.each(["admin", "superAdmin", "normalUser", "blogEditor:x", ""])(
    "rejects %j",
    (role) => {
      assert.isFalse(succeeds(PurchasableRole, role));
    },
  );
});

describe("Stripe ids and PaymentId", () => {
  it("accepts ids with their prefix", () => {
    assert.isTrue(succeeds(StripeProductId, "prod_Abc123"));
    assert.isTrue(succeeds(StripePriceId, "price_1Nxyz"));
    assert.isTrue(succeeds(StripeSubscriptionId, "sub_1Nxyz"));
    assert.isTrue(succeeds(PaymentId, paymentId));
  });

  it.each([
    [StripeProductId, "price_abc"],
    [StripeProductId, "prod_"],
    [StripeProductId, "prod_a b"],
    [StripePriceId, "prod_abc"],
    [StripeSubscriptionId, "sub-abc"],
    [StripeSubscriptionId, 5],
    [PaymentId, "not-a-uuid"],
  ])("rejects %j", (schema, value) => {
    assert.isFalse(succeeds(schema, value));
  });
});

describe("Currency and PaymentMoney", () => {
  it("accepts integer minor units and lowercase codes", () => {
    assert.isTrue(succeeds(PaymentMoney, { amount: 0, currency: "eur" }));
    assert.isTrue(succeeds(PaymentMoney, { amount: 1999, currency: "nzd" }));
  });

  it.each([
    ["a negative amount", { amount: -1, currency: "eur" }],
    ["a fractional amount", { amount: 19.99, currency: "eur" }],
    ["a string amount", { amount: "5", currency: "eur" }],
    ["an uppercase currency", { amount: 1, currency: "EUR" }],
    ["a long currency", { amount: 1, currency: "euro" }],
    ["a missing currency", { amount: 1 }],
  ])("rejects %s", (_, value) => {
    assert.isFalse(succeeds(PaymentMoney, value));
  });

  it.each(["EUR", "eu", "e1r", ""])("rejects the currency %j", (value) => {
    assert.isFalse(succeeds(Currency, value));
  });
});

describe("CheckoutRequest", () => {
  const decode = Schema.decodeUnknownSync(CheckoutRequest);

  it("accepts a price or a tip", () => {
    assert.deepStrictEqual(decode({ kind: "price", priceId: "price_abc" }), {
      kind: "price",
      priceId: "price_abc",
    });
    assert.deepStrictEqual(decode({ kind: "tip", amount: 500 }), {
      kind: "tip",
      amount: 500,
    });
  });

  it.each([
    ["a price without priceId", { kind: "price" }],
    ["a price with a bad id", { kind: "price", priceId: "prod_abc" }],
    ["a tip without amount", { kind: "tip" }],
    ["a zero tip", { kind: "tip", amount: 0 }],
    ["a negative tip", { kind: "tip", amount: -5 }],
    ["a fractional tip", { kind: "tip", amount: 2.5 }],
    ["an unknown kind", { kind: "gift", amount: 5 }],
    ["a missing kind", { priceId: "price_abc" }],
  ])("rejects %s", (_, value) => {
    assert.isFalse(succeeds(CheckoutRequest, value));
  });
});

describe("optional fields travel as null", () => {
  const catalog: typeof Catalog.Encoded = {
    products: [
      {
        id: "prod_a",
        name: "Food planner",
        description: null,
        roles: ["foodPlanner"],
        prices: [
          {
            id: "price_a",
            amount: { amount: 500, currency: "eur" },
            recurring: { interval: "month", intervalCount: 1 },
          },
          {
            id: "price_b",
            amount: { amount: 4900, currency: "eur" },
            recurring: null,
          },
        ],
      },
    ],
    tip: null,
  };

  it("decodes null to None and encodes None back to null", () => {
    const decoded = Schema.decodeUnknownSync(Catalog)(catalog);
    assert.isTrue(Option.isNone(decoded.tip));
    assert.isTrue(
      Option.isNone(decoded.products[0]?.description ?? Option.some("")),
    );
    assert.isTrue(
      Option.isSome(decoded.products[0]?.prices[0]?.recurring ?? Option.none()),
    );
    assert.deepStrictEqual(Schema.encodeSync(Catalog)(decoded), catalog);
  });

  it("rejects a recurring price with a zero count or an unknown interval", () => {
    const price = (recurring: unknown) => ({
      ...catalog,
      products: [
        {
          ...catalog.products[0],
          prices: [{ ...catalog.products[0]?.prices[0], recurring }],
        },
      ],
    });
    assert.isFalse(
      succeeds(Catalog, price({ interval: "month", intervalCount: 0 })),
    );
    assert.isFalse(
      succeeds(Catalog, price({ interval: "decade", intervalCount: 1 })),
    );
  });

  it("round-trips a payment", () => {
    const payment: typeof Payment.Encoded = {
      id: paymentId,
      kind: "tip",
      product: null,
      amount: { amount: 500, currency: "eur" },
      amountRefunded: 0,
      status: "partiallyRefunded",
      createdAt: at,
    };
    assert.deepStrictEqual(
      Schema.encodeSync(Payment)(Schema.decodeUnknownSync(Payment)(payment)),
      payment,
    );
    assert.isFalse(succeeds(Payment, { ...payment, amountRefunded: -1 }));
    assert.isFalse(succeeds(Payment, { ...payment, status: "paid_out" }));
  });
});

describe("cursors and the admin query", () => {
  const millis = Date.parse(at);

  it("round-trips a payment cursor", () => {
    const encoded = base64Url(JSON.stringify([millis, paymentId]));
    const decoded = Schema.decodeUnknownSync(PaymentCursor)(encoded);
    assert.strictEqual(DateTime.toEpochMillis(decoded.createdAt), millis);
    assert.strictEqual(decoded.id, paymentId);
    assert.strictEqual(Schema.encodeSync(PaymentCursor)(decoded), encoded);
  });

  it("round-trips a subscription cursor", () => {
    const encoded = base64Url(JSON.stringify([millis, "sub_abc"]));
    const decoded = Schema.decodeUnknownSync(SubscriptionCursor)(encoded);
    assert.strictEqual(decoded.id, "sub_abc");
    assert.strictEqual(Schema.encodeSync(SubscriptionCursor)(decoded), encoded);
  });

  it.each([
    ["not base64", "***"],
    ["a bad id", base64Url(JSON.stringify([millis, "nope"]))],
    ["a subscription id", base64Url(JSON.stringify([millis, "sub_abc"]))],
    ["the wrong shape", base64Url(JSON.stringify({ id: paymentId }))],
    ["too long", "a".repeat(200)],
  ])("rejects a payment cursor that is %s", (_, value) => {
    assert.isFalse(succeeds(PaymentCursor, value));
  });

  it("defaults the limit and bounds it to 1..200", () => {
    assert.strictEqual(
      Schema.decodeUnknownSync(AdminPaymentQuery)({}).limit,
      50,
    );
    assert.isTrue(succeeds(AdminPaymentQuery, { limit: 200 }));
    assert.isFalse(succeeds(AdminPaymentQuery, { limit: 0 }));
    assert.isFalse(succeeds(AdminPaymentQuery, { limit: 201 }));
    assert.isTrue(
      succeeds(AdminPaymentQuery, { userId, status: "disputeLost" }),
    );
    assert.isFalse(succeeds(AdminPaymentQuery, { userId: "nope" }));
    assert.isFalse(succeeds(AdminPaymentQuery, { status: "active" }));
  });
});

describe("admin payloads", () => {
  it("takes a refund amount or none", () => {
    assert.isTrue(succeeds(RefundPayload, {}));
    assert.isTrue(succeeds(RefundPayload, { amount: 100 }));
    assert.isFalse(succeeds(RefundPayload, { amount: 0 }));
    assert.isFalse(succeeds(RefundPayload, { amount: 1.5 }));
  });

  it("takes purchasable, unique roles", () => {
    assert.isTrue(succeeds(SetPaymentProductRolesPayload, { roles: [] }));
    assert.isTrue(
      succeeds(SetPaymentProductRolesPayload, { roles: ["foodPlanner"] }),
    );
    assert.isFalse(
      succeeds(SetPaymentProductRolesPayload, {
        roles: ["foodPlanner", "foodPlanner"],
      }),
    );
    assert.isFalse(
      succeeds(SetPaymentProductRolesPayload, { roles: ["admin"] }),
    );
  });
});
