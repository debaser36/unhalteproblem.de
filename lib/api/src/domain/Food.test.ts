import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import {
  currencyOfCountry,
  FoodCountry,
  FoodItemId,
  FoodItemQuery,
  FoodPrice,
  MealPlan,
  MealPlanRequest,
  MealPlanSummary,
  Money,
  Quantity,
} from "./Food.ts";
import { IsoDate } from "./IsoDate.ts";

const succeeds = <S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("IsoDate", () => {
  it.each(["2026-10-22", "2024-02-29", "0001-01-01"])("accepts %j", (date) => {
    assert.isTrue(succeeds(IsoDate, date));
  });

  it.each([
    ["a date that does not exist", "2026-02-30"],
    ["a leap day in a common year", "2026-02-29"],
    ["month 13", "2026-13-01"],
    ["a date-time", "2026-10-22T12:00:00Z"],
    ["slashes", "2026/10/22"],
    ["a missing zero", "2026-1-2"],
    ["a number", 20261022],
  ])("rejects %s", (_, value) => {
    assert.isFalse(succeeds(IsoDate, value));
  });
});

describe("FoodCountry and currencies", () => {
  it("supports Germany and New Zealand", () => {
    assert.deepStrictEqual([...FoodCountry.literals], ["DE", "NZ"]);
    assert.deepStrictEqual(currencyOfCountry, { DE: "EUR", NZ: "NZD" });
  });
});

describe("Money and Quantity", () => {
  it("accepts 0 and positive finite amounts of money", () => {
    assert.isTrue(succeeds(Money, 0));
    assert.isTrue(succeeds(Money, 3.49));
  });

  it.each([-0.01, Number.POSITIVE_INFINITY, Number.NaN, "3"])(
    "rejects the money %j",
    (value) => {
      assert.isFalse(succeeds(Money, value));
    },
  );

  it("needs an amount greater than 0 and a known unit", () => {
    assert.isTrue(succeeds(Quantity, { amount: 500, unit: "g" }));
    assert.isFalse(succeeds(Quantity, { amount: 0, unit: "g" }));
    assert.isFalse(succeeds(Quantity, { amount: 1, unit: "kg" }));
  });
});

describe("FoodPrice", () => {
  const price = {
    amount: 1.19,
    currency: "EUR",
    source: "openPrices",
    accuracy: 80,
    observedOn: "2026-10-20",
    where: "Lidl, Berlin",
    discounted: false,
  };

  it("accepts a price", () => {
    assert.isTrue(succeeds(FoodPrice, price));
  });

  it.each([
    ["an accuracy above 100", { ...price, accuracy: 101 }],
    ["a negative accuracy", { ...price, accuracy: -1 }],
    ["a fractional accuracy", { ...price, accuracy: 50.5 }],
    ["an unknown source", { ...price, source: "guess" }],
    ["a date-time as the day", { ...price, observedOn: "2026-10-20T00:00Z" }],
  ])("rejects %s", (_, value) => {
    assert.isFalse(succeeds(FoodPrice, value));
  });
});

describe("MealPlanRequest", () => {
  const request = {
    country: "DE",
    people: 2,
    meals: ["breakfast", "dinner"],
    diet: "vegetarian",
  };

  it("accepts the required fields alone", () => {
    assert.isTrue(succeeds(MealPlanRequest, request));
  });

  it("accepts all optional fields", () => {
    assert.isTrue(
      succeeds(MealPlanRequest, {
        ...request,
        budget: 80.5,
        exclude: ["apples", "peanuts"],
        preferences: "high protein, quick dinners",
      }),
    );
  });

  it.each([
    ["no people", { ...request, people: 0 }],
    ["nine people", { ...request, people: 9 }],
    ["half a person", { ...request, people: 1.5 }],
    ["no meals", { ...request, meals: [] }],
    ["a duplicate meal", { ...request, meals: ["lunch", "lunch"] }],
    [
      "five meals",
      { ...request, meals: ["breakfast", "lunch", "dinner", "snack", "snack"] },
    ],
    ["an unknown meal", { ...request, meals: ["brunch"] }],
    ["a budget of 0", { ...request, budget: 0 }],
    ["a negative budget", { ...request, budget: -5 }],
    ["a budget above 10000", { ...request, budget: 10000.01 }],
    ["an unknown country", { ...request, country: "FR" }],
    ["an unknown diet", { ...request, diet: "keto" }],
    ["an empty exclusion", { ...request, exclude: [""] }],
    ["an untrimmed exclusion", { ...request, exclude: [" apples"] }],
    ["a long exclusion", { ...request, exclude: ["a".repeat(51)] }],
    [
      "21 exclusions",
      { ...request, exclude: Array.from({ length: 21 }, (_, i) => `x${i}`) },
    ],
    ["long preferences", { ...request, preferences: "a".repeat(501) }],
    ["a NUL in the preferences", { ...request, preferences: "a\u0000b" }],
  ])("rejects %s", (_, value) => {
    assert.isFalse(succeeds(MealPlanRequest, value));
  });

  it("accepts a budget of 10000 and 8 people", () => {
    assert.isTrue(
      succeeds(MealPlanRequest, { ...request, budget: 10000, people: 8 }),
    );
  });
});

describe("FoodItemQuery", () => {
  const decode = Schema.decodeUnknownExit(FoodItemQuery);
  // What the HTTP layer does with the query string: every value is a string.
  const decodeQueryString = Schema.decodeUnknownExit(
    Schema.toCodecStringTree(FoodItemQuery),
  );

  it("needs only the country", () => {
    assert.deepStrictEqual(
      decodeQueryString({ country: "NZ" }),
      Exit.succeed({ country: "NZ" }),
    );
    assert.isTrue(Exit.isFailure(decode({})));
  });

  it("decodes booleans and numbers from query string values", () => {
    assert.deepStrictEqual(
      decodeQueryString({
        country: "DE",
        q: "milk",
        diet: "vegan",
        priced: "true",
        lookup: "false",
        limit: "20",
        offset: "40",
      }),
      Exit.succeed({
        country: "DE",
        q: "milk",
        diet: "vegan",
        priced: true,
        lookup: false,
        limit: 20,
        offset: 40,
      }),
    );
  });

  it.each([
    ["an empty term", { country: "DE", q: "" }],
    ["an untrimmed term", { country: "DE", q: " milk" }],
    ["a long term", { country: "DE", q: "a".repeat(101) }],
    ["a limit of 0", { country: "DE", limit: "0" }],
    ["a limit above 100", { country: "DE", limit: "101" }],
    ["a negative offset", { country: "DE", offset: "-1" }],
    ["an offset above 10000", { country: "DE", offset: "10001" }],
    ["a fractional limit", { country: "DE", limit: "1.5" }],
    ["a bad boolean", { country: "DE", priced: "yes" }],
    ["an unknown diet", { country: "DE", diet: "keto" }],
  ])("rejects %s", (_, value) => {
    assert.isTrue(Exit.isFailure(decodeQueryString(value)));
  });
});

describe("MealPlan", () => {
  const id = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
  const request = {
    country: "NZ",
    people: 1,
    meals: ["dinner"],
    diet: "omnivore",
  };

  it("accepts a pending plan with nulls and empty lists", () => {
    assert.isTrue(
      succeeds(MealPlan, {
        id,
        status: "pending",
        failure: null,
        country: "NZ",
        currency: "NZD",
        request,
        days: [],
        shoppingList: [],
        totalCost: null,
        estimatedShare: null,
        accuracy: null,
        notes: "",
        model: null,
        createdAt: "2026-10-22T12:00:00.000Z",
        finishedAt: null,
      }),
    );
  });

  it("accepts a failed plan with its reason", () => {
    assert.isTrue(
      succeeds(MealPlanSummary, {
        id,
        status: "failed",
        country: "NZ",
        currency: "NZD",
        people: 1,
        diet: "omnivore",
        budget: 20,
        totalCost: null,
        accuracy: null,
        createdAt: "2026-10-22T12:00:00.000Z",
      }),
    );
    assert.isFalse(succeeds(MealPlanSummary, { id, status: "queued" }));
  });
});

describe("FoodItemId", () => {
  it("is a UUID", () => {
    assert.isTrue(succeeds(FoodItemId, "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f"));
    assert.isFalse(succeeds(FoodItemId, "apples"));
  });
});
