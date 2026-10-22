import type { Package } from "./Classification.ts";

/**
 * How much a price can be trusted, and what a week of meals costs. Pure
 * functions; `today` is always passed in as `YYYY-MM-DD`.
 *
 * Accuracy is a guess in percent at how close the stored amount is to
 * what one package costs in the country today. Each price gets a base
 * accuracy when it is stored (from its source) and loses some with age.
 */

export type PriceSource = "openPrices" | "statsNz" | "estimate";

/** A stored price: of one package of its food. */
export interface Price {
  readonly amount: number;
  readonly currency: "EUR" | "NZD";
  readonly source: PriceSource;
  /** `YYYY-MM-DD`. */
  readonly observedOn: string;
  /** Base accuracy when stored, 0 to 100; see `effectiveAccuracy`. */
  readonly accuracy: number;
  readonly where: string;
  readonly discounted: boolean;
}

/**
 * Base accuracies. A price seen on a shelf or receipt is what that shop
 * charged that day: close for that shop, less so for the country (other
 * chains, regions). A discounted one was a promotion and is not what the
 * package usually costs. Stats NZ's averages cover the whole country but
 * no particular shop. An estimate is Claude's guess, capped low.
 */
export const baseAccuracy = {
  openPricesProduct: 85,
  openPricesCategory: 80,
  discountPenalty: 25,
  statsNz: 75,
  estimateCap: 40,
} as const;

/** What age costs per month, after a grace period of months. */
const ageing: Record<PriceSource, { grace: number; perMonth: number }> = {
  openPrices: { grace: 1, perMonth: 3 },
  // A Stats NZ release describes the month before last when it comes out.
  statsNz: { grace: 2, perMonth: 4 },
  estimate: { grace: 0, perMonth: 2 },
};

const minimumAccuracy = 5;

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The accuracy of `price` on `today`: its base accuracy, less its age. */
export const effectiveAccuracy = (price: Price, today: string): number => {
  const months = Math.max(
    0,
    Math.floor(daysBetween(price.observedOn, today) / 30),
  );
  const { grace, perMonth } = ageing[price.source];
  const lost = Math.max(0, months - grace) * perMonth;
  return Math.max(
    minimumAccuracy,
    Math.min(100, Math.round(price.accuracy - lost)),
  );
};

/** `price` with its accuracy for `today`. */
export const asOf = (price: Price, today: string): Price => ({
  ...price,
  accuracy: effectiveAccuracy(price, today),
});

/**
 * The price to plan with: the most accurate one today, then the newest,
 * then the cheapest. Returned with its accuracy for `today`.
 */
export const bestPrice = (
  prices: ReadonlyArray<Price>,
  today: string,
): Price | undefined => {
  let best: Price | undefined;
  for (const candidate of prices.map((price) => asOf(price, today))) {
    if (
      best === undefined ||
      candidate.accuracy > best.accuracy ||
      (candidate.accuracy === best.accuracy &&
        (candidate.observedOn > best.observedOn ||
          (candidate.observedOn === best.observedOn &&
            candidate.amount < best.amount)))
    ) {
      best = candidate;
    }
  }
  return best;
};

/** A food the planner may use, with the price it is planned with. */
export interface PlannedFood {
  readonly id: string;
  readonly name: string;
  readonly package: Package;
  readonly price: Price;
}

/** An amount of a food used in a meal, in the food's package unit. */
export interface Use {
  readonly foodId: string;
  readonly amount: number;
}

export interface ShoppingLine {
  readonly food: PlannedFood;
  /** Everything the week's meals use, in the package's unit. */
  readonly needed: number;
  /** Whole packages to buy. */
  readonly packages: number;
  readonly cost: number;
}

export interface Shopping {
  readonly lines: ReadonlyArray<ShoppingLine>;
  readonly total: number;
  /** Percent of the total that rests on estimated prices. */
  readonly estimatedShare: number;
  /** The lines' accuracies, weighted by cost; 0 for an empty list. */
  readonly accuracy: number;
}

const cents = (amount: number) => Math.round(amount * 100) / 100;

/**
 * What to buy for a week of meals: whole packages of every food used
 * (leftovers are bought too), most expensive first. Uses of foods that are
 * not in `foods` are a bug of the caller and throw.
 */
export const shoppingFor = (
  uses: ReadonlyArray<Use>,
  foods: ReadonlyMap<string, PlannedFood>,
): Shopping => {
  const needed = new Map<string, number>();
  for (const use of uses) {
    needed.set(use.foodId, (needed.get(use.foodId) ?? 0) + use.amount);
  }
  const lines = [...needed].map(([id, amount]): ShoppingLine => {
    const food = foods.get(id);
    if (food === undefined) throw new Error(`Unknown food ${id}`);
    // A rounding error of a millionth must not buy another package.
    const packages = Math.max(
      1,
      Math.ceil(amount / food.package.amount - 1e-6),
    );
    return {
      food,
      needed: amount,
      packages,
      cost: cents(packages * food.price.amount),
    };
  });
  lines.sort(
    (a, b) => b.cost - a.cost || a.food.name.localeCompare(b.food.name),
  );
  const total = cents(lines.reduce((sum, line) => sum + line.cost, 0));
  const estimated = lines
    .filter((line) => line.food.price.source === "estimate")
    .reduce((sum, line) => sum + line.cost, 0);
  const weighted = lines.reduce(
    (sum, line) => sum + line.cost * line.food.price.accuracy,
    0,
  );
  return {
    lines,
    total,
    estimatedShare: total > 0 ? Math.round((estimated / total) * 100) : 0,
    accuracy:
      total > 0
        ? Math.round(weighted / total)
        : lines.length > 0
          ? Math.round(
              lines.reduce((sum, line) => sum + line.food.price.accuracy, 0) /
                lines.length,
            )
          : 0,
  };
};
