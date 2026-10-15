import { describe, expect, it } from "vitest";
import { calculateKiwiEarnings, type KiwiCalcInput } from "./kiwiCalc";

const base: KiwiCalcInput = {
  people: 3,
  totalBins: 1000,
  hoursWorked: 8,
  variety: "normal",
  binSize: "560",
  currency: "NZD",
  includeHolidayBonus: false,
  subtractTax: false,
  taxPercent: 17,
};

describe("calculateKiwiEarnings", () => {
  it("splits bins per person and per hour", () => {
    const result = calculateKiwiEarnings(base);
    expect(result.binsPerPersonTotal).toBeCloseTo(1000 / 3);
    expect(result.binsPerPersonPerHour).toBeCloseTo(1000 / 3 / 8);
  });

  it("pays the NZD rate per bin for the bin size and variety", () => {
    expect(calculateKiwiEarnings(base).earningsTotal).toBeCloseTo((25.18 * 1000) / 3);
    expect(calculateKiwiEarnings({ ...base, binSize: "600" }).earningsTotal).toBeCloseTo((27.54 * 1000) / 3);
    expect(calculateKiwiEarnings({ ...base, variety: "gold" }).earningsTotal).toBeCloseTo((28.0 * 1000) / 3);
    expect(
      calculateKiwiEarnings({ ...base, variety: "gold", binSize: "600" }).earningsTotal,
    ).toBeCloseTo((30.5 * 1000) / 3);
  });

  it("applies holiday pay, EUR conversion and tax", () => {
    const result = calculateKiwiEarnings({
      ...base,
      variety: "gold",
      binSize: "600",
      currency: "EUR",
      includeHolidayBonus: true,
      subtractTax: true,
    });
    // 30.5 * 1.08 / 2 = 16.47 per bin; * 1000/3 bins = 5490; minus 17 % tax
    expect(result.earningsTotal).toBeCloseTo(4556.7);
    expect(result.earningsPerHour).toBeCloseTo(4556.7 / 8);
  });

  it("ignores the tax rate unless tax is subtracted", () => {
    expect(calculateKiwiEarnings({ ...base, taxPercent: 50 }).earningsTotal).toBeCloseTo(
      (25.18 * 1000) / 3,
    );
  });

  it("returns null for everything until people and bins are positive", () => {
    for (const input of [
      { ...base, people: 0 },
      { ...base, totalBins: 0 },
      { ...base, people: -2 },
      { ...base, people: Number.NaN },
    ]) {
      expect(calculateKiwiEarnings(input)).toEqual({
        binsPerPersonTotal: null,
        binsPerPersonPerHour: null,
        earningsTotal: null,
        earningsPerHour: null,
      });
    }
  });

  it("leaves the per-hour values null without hours worked", () => {
    const result = calculateKiwiEarnings({ ...base, hoursWorked: 0 });
    expect(result.earningsTotal).toBeCloseTo((25.18 * 1000) / 3);
    expect(result.binsPerPersonPerHour).toBeNull();
    expect(result.earningsPerHour).toBeNull();
  });
});
