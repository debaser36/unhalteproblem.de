import { assert, describe, it } from "@effect/vitest";
import {
  asOf,
  bestPrice,
  effectiveAccuracy,
  type PlannedFood,
  type Price,
  shoppingFor,
} from "./Pricing.ts";

const price = (overrides: Partial<Price> = {}): Price => ({
  amount: 2,
  currency: "EUR",
  source: "openPrices",
  observedOn: "2026-10-01",
  accuracy: 85,
  where: "Lidl, Berlin",
  discounted: false,
  ...overrides,
});

describe("effectiveAccuracy", () => {
  it("keeps Open Prices for a month, then takes 3 a month", () => {
    assert.strictEqual(effectiveAccuracy(price(), "2026-10-22"), 85);
    assert.strictEqual(
      effectiveAccuracy(price({ observedOn: "2026-09-01" }), "2026-10-22"),
      85,
    );
    assert.strictEqual(
      effectiveAccuracy(price({ observedOn: "2026-07-01" }), "2026-10-22"),
      79,
    );
  });

  it("keeps Stats NZ for two months, then takes 4 a month", () => {
    const average = price({ source: "statsNz", accuracy: 75 });
    assert.strictEqual(
      effectiveAccuracy({ ...average, observedOn: "2026-08-15" }, "2026-10-22"),
      75,
    );
    assert.strictEqual(
      effectiveAccuracy({ ...average, observedOn: "2026-06-15" }, "2026-10-22"),
      67,
    );
  });

  it("takes 2 a month from estimates at once", () => {
    const estimate = price({
      source: "estimate",
      accuracy: 40,
      observedOn: "2026-07-24",
    });
    assert.strictEqual(effectiveAccuracy(estimate, "2026-10-22"), 34);
  });

  it("never goes below 5", () => {
    assert.strictEqual(
      effectiveAccuracy(price({ observedOn: "2020-01-01" }), "2026-10-22"),
      5,
    );
  });

  it("asOf replaces the accuracy", () => {
    assert.strictEqual(
      asOf(price({ observedOn: "2026-07-01" }), "2026-10-22").accuracy,
      79,
    );
  });
});

describe("bestPrice", () => {
  it("prefers the most accurate, then the newest, then the cheapest", () => {
    const old = price({ observedOn: "2025-10-01", amount: 1 });
    const estimate = price({
      source: "estimate",
      accuracy: 40,
      observedOn: "2026-10-20",
    });
    const recent = price({ observedOn: "2026-10-10", amount: 2.5 });
    const best = bestPrice([old, estimate, recent], "2026-10-22");
    assert.strictEqual(best?.amount, 2.5);
    assert.strictEqual(best?.accuracy, 85);

    const cheaper = price({ observedOn: "2026-10-10", amount: 2.2 });
    assert.strictEqual(bestPrice([recent, cheaper], "2026-10-22")?.amount, 2.2);
  });

  it("is undefined without prices", () => {
    assert.isUndefined(bestPrice([], "2026-10-22"));
  });
});

describe("shoppingFor", () => {
  const pasta: PlannedFood = {
    id: "pasta",
    name: "Pasta",
    package: { amount: 500, unit: "g" },
    price: price({ amount: 1.29, accuracy: 80 }),
  };
  const eggs: PlannedFood = {
    id: "eggs",
    name: "Eggs",
    package: { amount: 10, unit: "piece" },
    price: price({ amount: 3, source: "estimate", accuracy: 30 }),
  };
  const foods = new Map([
    [pasta.id, pasta],
    [eggs.id, eggs],
  ]);

  it("buys whole packages, most expensive first", () => {
    const shopping = shoppingFor(
      [
        { foodId: "pasta", amount: 400 },
        { foodId: "pasta", amount: 800 },
        { foodId: "eggs", amount: 4 },
      ],
      foods,
    );
    assert.deepStrictEqual(
      shopping.lines.map((line) => [
        line.food.id,
        line.needed,
        line.packages,
        line.cost,
      ]),
      [
        ["pasta", 1200, 3, 3.87],
        ["eggs", 4, 1, 3],
      ],
    );
    assert.strictEqual(shopping.total, 6.87);
    // 3 of 6.87 is estimated.
    assert.strictEqual(shopping.estimatedShare, 44);
    // (3.87 * 80 + 3 * 30) / 6.87
    assert.strictEqual(shopping.accuracy, 58);
  });

  it("does not buy another package for a rounding error", () => {
    const shopping = shoppingFor(
      [{ foodId: "pasta", amount: 500.0000001 }],
      foods,
    );
    assert.strictEqual(shopping.lines[0]?.packages, 1);
  });

  it("is empty without uses", () => {
    assert.deepStrictEqual(shoppingFor([], foods), {
      lines: [],
      total: 0,
      estimatedShare: 0,
      accuracy: 0,
    });
  });

  it("throws on a food it does not know", () => {
    assert.throws(() => shoppingFor([{ foodId: "nope", amount: 1 }], foods));
  });
});
