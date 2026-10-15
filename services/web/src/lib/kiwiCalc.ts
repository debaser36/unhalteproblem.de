export type KiwiVariety = "normal" | "gold";
export type BinSize = "560" | "600";
export type Currency = "EUR" | "NZD";

export interface KiwiCalcInput {
  people: number;
  totalBins: number;
  hoursWorked: number;
  variety: KiwiVariety;
  binSize: BinSize;
  currency: Currency;
  includeHolidayBonus: boolean;
  subtractTax: boolean;
  /** Tax rate in percent, e.g. 17 for 17 %. */
  taxPercent: number;
}

export interface KiwiCalcResult {
  binsPerPersonTotal: number | null;
  binsPerPersonPerHour: number | null;
  earningsTotal: number | null;
  earningsPerHour: number | null;
}

/** Pay per bin in NZD, by bin size and variety (normal = Hayward, gold). */
export const RATES_NZD: Record<BinSize, Record<KiwiVariety, number>> = {
  "560": { normal: 25.18, gold: 28.0 },
  "600": { normal: 27.54, gold: 30.5 },
};

const HOLIDAY_PAY_FACTOR = 1.08;
/** Rough NZD → EUR conversion used for the EUR display. */
const NZD_PER_EUR = 2;

/**
 * Bins and earnings per person. Values that cannot be computed yet
 * (missing or non-positive inputs) are null.
 */
export function calculateKiwiEarnings(input: KiwiCalcInput): KiwiCalcResult {
  const { people, totalBins, hoursWorked } = input;

  const binsPerPersonTotal = people > 0 && totalBins > 0 ? totalBins / people : null;
  const binsPerPersonPerHour =
    binsPerPersonTotal !== null && hoursWorked > 0 ? binsPerPersonTotal / hoursWorked : null;

  if (binsPerPersonTotal === null) {
    return { binsPerPersonTotal, binsPerPersonPerHour, earningsTotal: null, earningsPerHour: null };
  }

  let earnings = RATES_NZD[input.binSize][input.variety];
  if (input.includeHolidayBonus) earnings *= HOLIDAY_PAY_FACTOR;
  if (input.currency === "EUR") earnings /= NZD_PER_EUR;
  earnings *= binsPerPersonTotal;
  if (input.subtractTax) earnings -= earnings * (input.taxPercent / 100);

  return {
    binsPerPersonTotal,
    binsPerPersonPerHour,
    earningsTotal: earnings,
    earningsPerHour: binsPerPersonPerHour !== null ? earnings / hoursWorked : null,
  };
}
