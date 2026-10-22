import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Claude, type ClaudeFailed } from "#infrastructure/Claude";
import {
  OpenFoodFacts,
  type OpenFoodFactsFailed,
  lookupBatchSize,
  type OffProduct,
} from "#infrastructure/OpenFoodFacts";
import {
  type OpenPrice,
  OpenPrices,
  type OpenPricesFailed,
} from "#infrastructure/OpenPrices";
import { StatsNz, type StatsNzFailed } from "#infrastructure/StatsNz";
import {
  dietOfName,
  dietOfProduct,
  nameOfCategory,
  packageOfTitle,
} from "./Classification.ts";
import {
  FoodRepository,
  type ItemInput,
  type ItemRow,
} from "./FoodRepository.ts";
import { baseAccuracy } from "./Pricing.ts";

/**
 * The imports behind `startFoodImport`: each reads one source for one
 * country and writes items and prices. They run in the background (see
 * `FoodJobs`), may run again after a crash, and only ever upsert, so a
 * second run changes nothing that the first one did not.
 */

export type Country = "DE" | "NZ";
export type ImportSource = "openPrices" | "statsNz" | "priceEstimates";

/** What an import wrote: items created or updated, prices stored. */
export interface ImportCounts {
  readonly items: number;
  readonly prices: number;
}

export type ImportFailure =
  OpenPricesFailed | OpenFoodFactsFailed | StatsNzFailed | ClaudeFailed;

const currencies = { DE: "EUR", NZ: "NZD" } as const;
const countryNames = { DE: "Germany", NZ: "New Zealand" } as const;

/** Prices older than this are not imported. */
const priceHistory = Duration.days(365);
/** Products looked up less than this ago are not looked up again. */
const productRefresh = Duration.days(30);
/** Products looked up per Open Prices import (at 100 per request). */
export const productsPerImport = 3000;
/** Items priced per estimate import, and per request to Claude. */
export const estimatesPerImport = 300;
const estimatesPerRequest = 50;

/** Whether `source` has data for `country`. */
export const supports = (country: Country, source: ImportSource): boolean =>
  source !== "statsNz" || country === "NZ";

/** Where an Open Prices price was seen, for `FoodPrice.where`. */
export const whereOf = (price: OpenPrice, country: Country): string => {
  const shop = price.location.name ?? `A shop in ${countryNames[country]}`;
  return price.location.city === null
    ? shop
    : `${shop}, ${price.location.city}`;
};

/** The item of an Open Food Facts product. */
export const itemOfProduct = (
  product: OffProduct,
  country: Country,
): ItemInput => ({
  country,
  source: "openFoodFacts",
  sourceRef: product.code,
  name: product.name,
  brand: product.brand,
  quantity: product.quantity,
  ...dietOfProduct(product.labels, product.ingredientsAnalysis),
  categories: product.categories,
  ingredients: product.ingredients,
  allergens: product.allergens,
});

/**
 * The item of an Open Prices category price (loose produce): one per
 * category and unit, `en:apples/kg` for 1 kg, `en:avocados/piece` for one.
 */
export const itemOfCategory = (
  category: string,
  per: "kilogram" | "unit",
  country: Country,
): ItemInput => ({
  country,
  source: "openPricesCategory",
  sourceRef: `${category}/${per === "kilogram" ? "kg" : "piece"}`,
  name:
    per === "kilogram"
      ? `${nameOfCategory(category)}, 1kg`
      : `${nameOfCategory(category)}, each`,
  brand: null,
  quantity:
    per === "kilogram"
      ? { amount: 1000, unit: "g" }
      : { amount: 1, unit: "piece" },
  ...dietOfName(category),
  categories: [category],
  ingredients: [],
  allergens: [],
});

const EstimateAnswer = Schema.Struct({
  prices: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      amount: Schema.Number,
      confidence: Schema.Number,
    }),
  ),
});

const estimateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prices"],
  properties: {
    prices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "amount", "confidence"],
        properties: {
          ref: { type: "string" },
          amount: {
            type: "number",
            description:
              "Regular shelf price of one package, in the currency given.",
          },
          confidence: {
            type: "integer",
            description:
              "0 to 100: how sure you are the price is within 15% of today's typical price.",
          },
        },
      },
    },
  },
} as const;

const estimateSystem = `You estimate grocery prices. For each product, give the regular (not discounted) shelf price of one package as sold today in a mainstream supermarket of the given country, in the given currency, and how confident you are. Use your knowledge of typical prices; say so with a low confidence when you are unsure. Answer for every reference given.`;

const make = Effect.gen(function* () {
  const repository = yield* FoodRepository;
  const openPrices = yield* OpenPrices;
  const openFoodFacts = yield* OpenFoodFacts;
  const statsNz = yield* StatsNz;
  const claude = yield* Claude;

  const upsertItem = (now: DateTime.Utc, item: ItemInput) =>
    repository.upsertItem(crypto.randomUUID(), now, item);

  const importOpenPrices = Effect.fn("FoodImporter.openPrices")(function* (
    country: Country,
  ) {
    const now = yield* DateTime.now;
    const since = DateTime.formatIsoDateUtc(
      DateTime.subtractDuration(now, priceHistory),
    );
    const prices = yield* openPrices.prices(
      country,
      currencies[country],
      since,
    );
    let items = 0;
    let stored = 0;
    const itemIds = new Map<string, string>();

    // Loose produce: one item per category and unit.
    for (const price of prices) {
      if (price.category === null || price.per === null) continue;
      const item = itemOfCategory(price.category, price.per, country);
      if (!itemIds.has(item.sourceRef)) {
        itemIds.set(item.sourceRef, yield* upsertItem(now, item));
        items++;
      }
    }

    // Products: looked up on Open Food Facts unless that was done lately.
    const codes = [
      ...new Set(
        prices.flatMap((price) => (price.code === null ? [] : [price.code])),
      ),
    ];
    const known = yield* repository.knownRefs(country, "openFoodFacts", codes);
    const fresh = DateTime.subtractDuration(now, productRefresh);
    const stale: Array<string> = [];
    for (const code of codes) {
      const item = known.get(code);
      if (item !== undefined && DateTime.isGreaterThan(item.updatedAt, fresh)) {
        itemIds.set(code, item.id);
      } else {
        stale.push(code);
      }
    }
    // Batch by batch, each stored at once: a batch that fails ends the
    // lookups but keeps what came before, and the prices are still stored.
    // The rest waits for the next import, which skips what is fresh.
    const wanted = stale.slice(0, productsPerImport);
    for (let i = 0; i < wanted.length; i += lookupBatchSize) {
      const found = yield* openFoodFacts
        .lookup(wanted.slice(i, i + lookupBatchSize))
        .pipe(
          Effect.catchTag("OpenFoodFactsFailed", (error) =>
            Effect.logWarning("Open Food Facts lookups stopped", error).pipe(
              Effect.as(undefined),
            ),
          ),
        );
      if (found === undefined) break;
      for (const product of found) {
        itemIds.set(
          product.code,
          yield* upsertItem(now, itemOfProduct(product, country)),
        );
        items++;
      }
    }
    // Products Open Food Facts does not know, or that are not looked up
    // yet, keep the item they had, if any.
    for (const code of stale) {
      const item = known.get(code);
      if (item !== undefined && !itemIds.has(code)) itemIds.set(code, item.id);
    }

    for (const price of prices) {
      const ref =
        price.code ??
        (price.category !== null && price.per !== null
          ? itemOfCategory(price.category, price.per, country).sourceRef
          : null);
      const foodItemId = ref === null ? undefined : itemIds.get(ref);
      if (foodItemId === undefined) continue;
      const base =
        price.code === null
          ? baseAccuracy.openPricesCategory
          : baseAccuracy.openPricesProduct;
      yield* repository.upsertPrice(now, {
        foodItemId,
        source: "openPrices",
        sourceRef: String(price.id),
        amount: price.price,
        currency: currencies[country],
        observedOn: price.date,
        accuracy: price.discounted ? base - baseAccuracy.discountPenalty : base,
        where: whereOf(price, country),
        discounted: price.discounted,
      });
      stored++;
    }
    return { items, prices: stored } satisfies ImportCounts;
  });

  const importStatsNz = Effect.fn("FoodImporter.statsNz")(function* () {
    const now = yield* DateTime.now;
    const averages = yield* statsNz.latestAveragePrices;
    let stored = 0;
    for (const average of averages) {
      const foodItemId = yield* upsertItem(now, {
        country: "NZ",
        source: "statsNz",
        sourceRef: average.series,
        name: average.title.slice(0, 300),
        brand: null,
        quantity: packageOfTitle(average.title),
        ...dietOfName(average.title),
        categories: [],
        ingredients: [],
        allergens: [],
      });
      yield* repository.upsertPrice(now, {
        foodItemId,
        source: "statsNz",
        sourceRef: `${average.series}:${average.month}`,
        amount: average.price,
        currency: "NZD",
        // A monthly average: the middle of its month.
        observedOn: `${average.month}-15`,
        accuracy: baseAccuracy.statsNz,
        where:
          "Average of supermarkets and other shops in 12 NZ urban areas (Stats NZ)",
        discounted: false,
      });
      stored++;
    }
    return { items: averages.length, prices: stored } satisfies ImportCounts;
  });

  const describe = (item: ItemRow, currency: string) =>
    [
      // Quoted: names come from Open Food Facts, which anyone can edit.
      JSON.stringify(
        item.brand === null ? item.name : `${item.name} (${item.brand})`,
      ),
      `${item.quantityAmount} ${item.quantityUnit === "piece" ? "pcs" : item.quantityUnit}`,
      currency,
    ].join(" | ");

  const importEstimates = Effect.fn("FoodImporter.priceEstimates")(function* (
    country: Country,
  ) {
    const now = yield* DateTime.now;
    const today = DateTime.formatIsoDateUtc(now);
    const items = yield* repository.unpriced(country, estimatesPerImport);
    let stored = 0;
    for (let i = 0; i < items.length; i += estimatesPerRequest) {
      const batch = items.slice(i, i + estimatesPerRequest);
      const refs = new Map(batch.map((item, index) => [`p${index + 1}`, item]));
      const { value: answer } = yield* claude.json({
        system: estimateSystem,
        turns: [
          {
            role: "user",
            content: [
              `Country: ${countryNames[country]}`,
              "Products (reference | name | package | currency):",
              ...[...refs].map(
                ([ref, item]) =>
                  `${ref} | ${describe(item, currencies[country])}`,
              ),
            ].join("\n"),
          },
        ],
        jsonSchema: estimateJsonSchema,
        schema: EstimateAnswer,
      });
      for (const estimate of answer.prices) {
        const item = refs.get(estimate.ref);
        // An amount of 0 or above 1000 per package is not an estimate.
        if (
          item === undefined ||
          !Number.isFinite(estimate.amount) ||
          estimate.amount <= 0 ||
          estimate.amount > 1000
        ) {
          continue;
        }
        const confidence = Number.isFinite(estimate.confidence)
          ? Math.round(Math.max(0, Math.min(100, estimate.confidence)))
          : 0;
        yield* repository.upsertPrice(now, {
          foodItemId: item.id,
          source: "estimate",
          sourceRef: "estimate",
          amount: Math.round(estimate.amount * 100) / 100,
          currency: currencies[country],
          observedOn: today,
          accuracy: Math.min(confidence, baseAccuracy.estimateCap),
          where: `Estimate for a typical supermarket in ${countryNames[country]}`,
          discounted: false,
        });
        stored++;
      }
    }
    return { items: 0, prices: stored } satisfies ImportCounts;
  });

  return FoodImporter.of({
    run: (country, source) =>
      source === "openPrices"
        ? importOpenPrices(country)
        : source === "statsNz"
          ? importStatsNz()
          : importEstimates(country),

    lookup: Effect.fn("FoodImporter.lookup")(function* (
      term: string,
      country: Country,
    ) {
      const now = yield* DateTime.now;
      const products = yield* openFoodFacts.search(term, country);
      for (const product of products) {
        yield* upsertItem(now, itemOfProduct(product, country));
      }
      return products.length;
    }),
  });
});

/**
 * Reads the sources and writes `food_items` and `food_prices`. Writes
 * happen one statement at a time, outside any transaction: an import that
 * fails half way keeps what it wrote, and the next run carries on.
 */
export class FoodImporter extends Context.Service<
  FoodImporter,
  {
    /** One import of `source` for `country` (`supports` must hold). */
    readonly run: (
      country: Country,
      source: ImportSource,
    ) => Effect.Effect<
      ImportCounts,
      ImportFailure | import("effect/sql").SqlError.SqlError
    >;
    /**
     * Looks `term` up on Open Food Facts and stores the products found
     * (without prices); how many.
     */
    readonly lookup: (
      term: string,
      country: Country,
    ) => Effect.Effect<
      number,
      OpenFoodFactsFailed | import("effect/sql").SqlError.SqlError
    >;
  }
>()("@unhalteproblem.de/backend/domains/food/FoodImporter") {
  /** Needs `FoodRepository`, `OpenPrices`, `OpenFoodFacts`, `StatsNz` and `Claude`. */
  static readonly layer = Layer.effect(FoodImporter, make);
}
