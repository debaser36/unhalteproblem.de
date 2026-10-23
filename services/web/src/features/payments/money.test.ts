import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { formatMoney, formatPrice, parseAmount } from "./money.ts";

describe("formatMoney", () => {
  it("formats minor units in the currency", () => {
    expect(formatMoney({ amount: 500, currency: "eur" })).toBe("€5.00");
    expect(formatMoney({ amount: 1999, currency: "usd" })).toBe("$19.99");
    // No minor unit in yen.
    expect(formatMoney({ amount: 500, currency: "jpy" })).toBe("¥500");
  });
});

describe("formatPrice", () => {
  const amount = { amount: 500, currency: "eur" };

  it("shows a one-time price as its amount", () => {
    expect(
      formatPrice({ id: "price_1", amount, recurring: Option.none() }),
    ).toBe("€5.00");
  });

  it("adds the billing period of a recurring price", () => {
    expect(
      formatPrice({
        id: "price_1",
        amount,
        recurring: Option.some({ interval: "month", intervalCount: 1 }),
      }),
    ).toBe("€5.00 / month");
    expect(
      formatPrice({
        id: "price_1",
        amount,
        recurring: Option.some({ interval: "month", intervalCount: 3 }),
      }),
    ).toBe("€5.00 every 3 months");
  });
});

describe("parseAmount", () => {
  it("reads whole and decimal amounts with a point or a comma", () => {
    expect(parseAmount("5", "eur")).toBe(500);
    expect(parseAmount(" 5.5 ", "eur")).toBe(550);
    expect(parseAmount("5,05", "eur")).toBe(505);
    expect(parseAmount("12", "jpy")).toBe(12);
  });

  it("rejects what is not a positive amount", () => {
    for (const input of ["", "0", "0.00", "-5", "5.555", "abc", "5.", "1e3"]) {
      expect(parseAmount(input, "eur")).toBeUndefined();
    }
    expect(parseAmount("1.5", "jpy")).toBeUndefined();
  });
});
