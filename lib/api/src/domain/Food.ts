/**
 * The food planner: food items with prices from Open Food Facts, Open Prices
 * and Stats NZ, imports of that data, and weekly meal plans that an AI
 * writes from the priced foods. Germany (`DE`, EUR) and New Zealand (`NZ`,
 * NZD) are supported for now.
 */
import { IsoDate } from "#domain/IsoDate";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { noNul } from "#domain/Text";
import { Schema } from "effect";

/** Length and range limits of the food planner. */
export const FoodLimits = {
  /** Longest search term `q`. */
  searchMaxLength: 100,
  /** Largest `limit` of a search; the default is `defaultLimit`. */
  maxLimit: 100,
  /** The `limit` the backend applies when none is given. */
  defaultLimit: 50,
  /** Largest `offset` of a search. */
  maxOffset: 10000,
  /** Most prices in `FoodItemDetails.prices`. */
  maxPrices: 20,
  /** Most imports `GET /food/imports` lists. */
  maxImports: 50,
  /** Most people a meal plan can be for. */
  maxPeople: 8,
  /** Most meal slots per day of a meal plan. */
  maxMeals: 4,
  /** The days a meal plan always covers. */
  planDays: 7,
  /** Largest `MealPlanRequest.budget`. */
  maxBudget: 10000,
  /** Most entries in `MealPlanRequest.exclude`. */
  maxExclusions: 20,
  /** Longest entry of `MealPlanRequest.exclude`. */
  exclusionMaxLength: 50,
  /** Longest `MealPlanRequest.preferences`. */
  preferencesMaxLength: 500,
} as const;

/**
 * A country the food planner has data for, as an ISO 3166-1 alpha-2 code:
 * Germany (`DE`) or New Zealand (`NZ`).
 */
export const FoodCountry = Schema.Literals(["DE", "NZ"]).annotate({
  identifier: "FoodCountry",
  description:
    "A country with food data, as an ISO 3166-1 alpha-2 code: `DE` " +
    "(Germany) or `NZ` (New Zealand).",
});
export type FoodCountry = typeof FoodCountry.Type;

/** The currency of prices: euro (`EUR`) or New Zealand dollar (`NZD`). */
export const FoodCurrency = Schema.Literals(["EUR", "NZD"]).annotate({
  identifier: "FoodCurrency",
  description: "The currency of a price: `EUR` or `NZD`.",
});
export type FoodCurrency = typeof FoodCurrency.Type;

/** The currency of the prices in each country. */
export const currencyOfCountry: Record<FoodCountry, FoodCurrency> = {
  DE: "EUR",
  NZ: "NZD",
};

/** The id of a food item (a UUID). */
export const FoodItemId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("FoodItemId"))
  .annotate({
    identifier: "FoodItemId",
    description: "The id of a food item (a UUID).",
  });
export type FoodItemId = typeof FoodItemId.Type;

/** The id of a food data import (a UUID). */
export const FoodImportId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("FoodImportId"))
  .annotate({
    identifier: "FoodImportId",
    description: "The id of a food data import (a UUID).",
  });
export type FoodImportId = typeof FoodImportId.Type;

/** The id of a meal plan (a UUID). */
export const MealPlanId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("MealPlanId"))
  .annotate({
    identifier: "MealPlanId",
    description: "The id of a meal plan (a UUID).",
  });
export type MealPlanId = typeof MealPlanId.Type;

/** The unit of a `Quantity`: grams, millilitres or pieces. */
export const QuantityUnit = Schema.Literals(["g", "ml", "piece"]).annotate({
  identifier: "QuantityUnit",
  description: "The unit of a quantity: `g`, `ml` or `piece`.",
});
export type QuantityUnit = typeof QuantityUnit.Type;

/** An amount of a food, e.g. a package of 500 g. */
export const Quantity = Schema.Struct({
  /** Greater than 0. */
  amount: Schema.Finite.check(Schema.isGreaterThan(0)),
  unit: QuantityUnit,
}).annotate({
  identifier: "Quantity",
  description: "An amount of a food: a number greater than 0 and a unit.",
});
export type Quantity = typeof Quantity.Type;

/**
 * An amount of money in the currency of the country it belongs to, e.g.
 * `3.49`: a finite number, 0 or more.
 */
export const Money = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
).annotate({
  identifier: "Money",
  description:
    "An amount of money in the currency of the country, e.g. `3.49`: a " +
    "finite number, 0 or more.",
});
export type Money = typeof Money.Type;

/**
 * Where a price comes from:
 *
 * - `openPrices`: Open Prices, crowd-sourced shelf and receipt prices.
 * - `statsNz`: Stats NZ monthly weighted average prices.
 * - `estimate`: an AI estimate of a typical price.
 */
export const PriceSource = Schema.Literals([
  "openPrices",
  "statsNz",
  "estimate",
]).annotate({
  identifier: "PriceSource",
  description:
    "Where a price comes from: `openPrices` (crowd-sourced shelf and " +
    "receipt prices), `statsNz` (Stats NZ monthly weighted average prices) " +
    "or `estimate` (an AI estimate of a typical price).",
});
export type PriceSource = typeof PriceSource.Type;

/**
 * Where a food item comes from:
 *
 * - `openFoodFacts`: a barcoded product of Open Food Facts.
 * - `openPricesCategory`: a generic produce category priced on Open Prices,
 *   e.g. `en:apples` per kg.
 * - `statsNz`: a Stats NZ average-price item such as "Bananas, 1kg".
 */
export const FoodItemSource = Schema.Literals([
  "openFoodFacts",
  "openPricesCategory",
  "statsNz",
]).annotate({
  identifier: "FoodItemSource",
  description:
    "Where a food item comes from: `openFoodFacts` (a barcoded product), " +
    "`openPricesCategory` (a generic produce category priced on Open " +
    "Prices, e.g. `en:apples` per kg) or `statsNz` (a Stats NZ " +
    "average-price item such as `Bananas, 1kg`).",
});
export type FoodItemSource = typeof FoodItemSource.Type;

/**
 * A price of a food item. It is always the price of one package of the
 * item, that is for the item's `quantity`.
 */
export const FoodPrice = Schema.Struct({
  amount: Money,
  currency: FoodCurrency,
  source: PriceSource,
  /**
   * A guess, 0 to 100, at how far the amount can be trusted for this
   * country today: it takes the source, the age and a discount into account.
   */
  accuracy: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  /** The day the price was seen or, for an estimate, made. */
  observedOn: IsoDate,
  /**
   * Where it can be bought for that price, e.g. `Lidl, Berlin` or `Average
   * of NZ supermarkets`.
   */
  where: Schema.String,
  /** Whether it is a discount price (a special offer). */
  discounted: Schema.Boolean,
}).annotate({
  identifier: "FoodPrice",
  description:
    "A price of one package of a food item (its `quantity`). `accuracy` " +
    "(0 to 100) guesses how far the amount can be trusted for the country " +
    "today: source, age and discount. `where` says where it can be bought " +
    "for that price.",
});
export type FoodPrice = typeof FoodPrice.Type;

// The fields shared by FoodItem and FoodItemDetails.
const foodItemFields = {
  id: FoodItemId,
  country: FoodCountry,
  source: FoodItemSource,
  /**
   * The item in its source: the barcode of an Open Food Facts product, the
   * category tag of an Open Prices category or the Stats NZ series.
   */
  sourceRef: Schema.String,
  name: Schema.String,
  brand: Schema.NullOr(Schema.String),
  /** The package; `null` if unknown. */
  quantity: Schema.NullOr(Quantity),
  /** `null` if unknown. */
  vegetarian: Schema.NullOr(Schema.Boolean),
  /** `null` if unknown. */
  vegan: Schema.NullOr(Schema.Boolean),
  /** Open Food Facts taxonomy tags, e.g. `en:pastas`. */
  categories: Schema.Array(Schema.String),
  /** Open Food Facts allergen tags, e.g. `en:gluten`. */
  allergens: Schema.Array(Schema.String),
  /** The most trustworthy price; `null` if the item has none. */
  bestPrice: Schema.NullOr(FoodPrice),
};

/** A food item: a product or a generic food of one country, with its price. */
export const FoodItem = Schema.Struct(foodItemFields).annotate({
  identifier: "FoodItem",
  description:
    "A food item of one country: a product or a generic food, with its " +
    "package `quantity` and its most trustworthy price (`bestPrice`). " +
    "`vegetarian` and `vegan` are null if unknown.",
});
export type FoodItem = typeof FoodItem.Type;

/** A food item with its ingredients, its price history and its age. */
export const FoodItemDetails = Schema.Struct({
  ...foodItemFields,
  /** Ingredient tags. */
  ingredients: Schema.Array(Schema.String),
  /** Newest first, at most 20. */
  prices: Schema.Array(FoodPrice).check(
    Schema.isMaxLength(FoodLimits.maxPrices),
  ),
  updatedAt: IsoDateTimeUtc,
}).annotate({
  identifier: "FoodItemDetails",
  description:
    "A food item with its ingredient tags and up to 20 prices, newest " +
    "first.",
});
export type FoodItemDetails = typeof FoodItemDetails.Type;

/** The diet a food or a meal plan has to fit. */
export const Diet = Schema.Literals([
  "omnivore",
  "vegetarian",
  "vegan",
]).annotate({
  identifier: "Diet",
  description: "A diet: `omnivore`, `vegetarian` or `vegan`.",
});
export type Diet = typeof Diet.Type;

/**
 * Query of `GET /food/items`: the search for food items. Only `country` is
 * required. Over HTTP every value is a string: booleans are `true` or
 * `false`, numbers are decimal integers.
 */
export const FoodItemQuery = Schema.Struct({
  country: FoodCountry.annotateKey({
    description: "The country whose foods and prices to search.",
  }),
  /** Only items whose name matches this term. */
  q: Schema.optionalKey(
    Schema.Trimmed.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(FoodLimits.searchMaxLength),
      noNul,
    ),
  ).annotateKey({
    description:
      "Only items whose name matches this term: trimmed, 1 to 100 " +
      "characters.",
  }),
  /** Only items that fit this diet. */
  diet: Schema.optionalKey(Diet).annotateKey({
    description:
      "Only items that fit this diet (items whose diet is unknown are " +
      "left out for `vegetarian` and `vegan`).",
  }),
  /** `true`: only items with a price; `false`: only items without one. */
  priced: Schema.optionalKey(Schema.Boolean).annotateKey({
    description:
      "`true`: only items with a price. `false`: only items without one. " +
      "Leave out for both.",
  }),
  /**
   * Also look `q` up on Open Food Facts and cache what it finds. Only for
   * `foodPlanner`; ignored for a `mealPlanBuyer` without it.
   */
  lookup: Schema.optionalKey(Schema.Boolean).annotateKey({
    description:
      "`true`: also look the term `q` up on Open Food Facts and cache what " +
      "it finds, so later searches find it too. Only for `foodPlanner`: " +
      "for a `mealPlanBuyer` without it the parameter is ignored (the " +
      "search covers the stored data) and not refused.",
  }),
  /** Page size, 1 to 100; the backend applies 50 if absent. */
  limit: Schema.optionalKey(
    Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: FoodLimits.maxLimit }),
    ),
  ).annotateKey({
    description: "Page size, an integer from 1 to 100; 50 if absent.",
  }),
  /** How many items to skip, 0 to 10000; 0 if absent. */
  offset: Schema.optionalKey(
    Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: FoodLimits.maxOffset }),
    ),
  ).annotateKey({
    description:
      "How many items to skip, an integer from 0 to 10000; 0 if absent.",
  }),
}).annotate({
  identifier: "FoodItemQuery",
  description: "The search for food items of one country.",
});
export type FoodItemQuery = typeof FoodItemQuery.Type;

/** One page of food items. */
export const FoodItemPage = Schema.Struct({
  items: Schema.Array(FoodItem),
}).annotate({
  identifier: "FoodItemPage",
  description: "One page of food items.",
});
export type FoodItemPage = typeof FoodItemPage.Type;

/**
 * Where an import takes its data from: `openPrices` (Open Prices and the
 * Open Food Facts products it refers to), `statsNz` (Stats NZ average
 * prices, NZ only) or `priceEstimates` (AI estimates for items without a
 * price).
 */
export const FoodImportSource = Schema.Literals([
  "openPrices",
  "statsNz",
  "priceEstimates",
]).annotate({
  identifier: "FoodImportSource",
  description:
    "Where an import takes its data from: `openPrices` (Open Prices and " +
    "the Open Food Facts products it refers to), `statsNz` (Stats NZ " +
    "average prices, NZ only) or `priceEstimates` (AI estimates for items " +
    "without a price).",
});
export type FoodImportSource = typeof FoodImportSource.Type;

/** How far an import is: `queued`, `running`, `succeeded` or `failed`. */
export const FoodImportStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
]).annotate({
  identifier: "FoodImportStatus",
  description:
    "How far an import is: `queued`, `running`, `succeeded` or `failed`.",
});
export type FoodImportStatus = typeof FoodImportStatus.Type;

/** A run of the import of food data from one source for one country. */
export const FoodImport = Schema.Struct({
  id: FoodImportId,
  country: FoodCountry,
  source: FoodImportSource,
  status: FoodImportStatus,
  requestedAt: IsoDateTimeUtc,
  /** `null` while queued. */
  startedAt: Schema.NullOr(IsoDateTimeUtc),
  /** `null` until it succeeded or failed. */
  finishedAt: Schema.NullOr(IsoDateTimeUtc),
  /** The food items created or updated so far. */
  items: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The prices stored so far. */
  prices: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /**
   * The kind of failure only, never details, e.g.
   * `OpenPricesFailed:download:503`; `null` unless `failed`.
   */
  error: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "FoodImport",
  description:
    "A run of the import of food data from one source for one country. " +
    "`items` and `prices` count what it has stored so far. `error` names " +
    "the kind of failure only, e.g. `OpenPricesFailed:download:503`.",
});
export type FoodImport = typeof FoodImport.Type;

/** Body of `POST /food/imports`: which data to import. */
export const StartFoodImportPayload = Schema.Struct({
  country: FoodCountry,
  source: FoodImportSource,
}).annotate({
  identifier: "StartFoodImportPayload",
  description: "The country and the source of the data to import.",
});
export type StartFoodImportPayload = typeof StartFoodImportPayload.Type;

/**
 * A source of food data, for the attribution the licences require (the Open
 * Database License of Open Food Facts and Open Prices demands crediting).
 */
export const FoodDataSource = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  licence: Schema.String,
  countries: Schema.Array(FoodCountry),
  /** What the data is used for and what to credit. */
  note: Schema.String,
}).annotate({
  identifier: "FoodDataSource",
  description:
    "A source of food data with its licence and the countries it covers, " +
    "to credit in the interface.",
});
export type FoodDataSource = typeof FoodDataSource.Type;

/** A meal of the day: `breakfast`, `lunch`, `dinner` or `snack`. */
export const MealSlot = Schema.Literals([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]).annotate({
  identifier: "MealSlot",
  description: "A meal of the day: `breakfast`, `lunch`, `dinner` or `snack`.",
});
export type MealSlot = typeof MealSlot.Type;

/**
 * Body of `POST /food/meal-plans`: what the plan has to fit. The plan always
 * covers 7 days.
 */
export const MealPlanRequest = Schema.Struct({
  country: FoodCountry,
  /** The people to feed, 1 to 8. */
  people: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: FoodLimits.maxPeople }),
  ).annotateKey({ description: "The people to feed, an integer from 1 to 8." }),
  /** The meals to plan each day: 1 to 4, each at most once. */
  meals: Schema.UniqueArray(MealSlot)
    .check(Schema.isMinLength(1), Schema.isMaxLength(FoodLimits.maxMeals))
    .annotateKey({
      description:
        "The meals to plan each day: 1 to 4 slots, each at most once.",
    }),
  diet: Diet,
  /** For the whole week, in the country's currency; greater than 0. */
  budget: Schema.optionalKey(
    Schema.Finite.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(FoodLimits.maxBudget),
    ),
  ).annotateKey({
    description:
      "The most the shopping list may cost for the whole week, in the " +
      "currency of the country: greater than 0, at most 10000. No limit " +
      "if absent.",
  }),
  /** Ingredients or products to leave out, e.g. `apples`, `peanuts`. */
  exclude: Schema.optionalKey(
    Schema.Array(
      Schema.Trimmed.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(FoodLimits.exclusionMaxLength),
        noNul,
      ),
    ).check(Schema.isMaxLength(FoodLimits.maxExclusions)),
  ).annotateKey({
    description:
      "Ingredients or products to leave out, e.g. `apples` or `peanuts`: " +
      "at most 20 trimmed strings of 1 to 50 characters.",
  }),
  /** Free text for the planner, e.g. `high protein, quick dinners`. */
  preferences: Schema.optionalKey(
    Schema.String.check(
      Schema.isMaxLength(FoodLimits.preferencesMaxLength),
      noNul,
    ),
  ).annotateKey({
    description:
      "Free text for the planner, e.g. `high protein, quick dinners`: at " +
      "most 500 characters.",
  }),
}).annotate({
  identifier: "MealPlanRequest",
  description:
    "What a meal plan has to fit: country, people, meals per day, diet and " +
    "optionally a weekly budget, foods to leave out and preferences. The " +
    "plan always covers 7 days.",
});
export type MealPlanRequest = typeof MealPlanRequest.Type;

/** An ingredient of a meal: an amount of a food item. */
export const MealIngredient = Schema.Struct({
  itemId: FoodItemId,
  name: Schema.String,
  /** Greater than 0. */
  amount: Schema.Finite.check(Schema.isGreaterThan(0)),
  unit: QuantityUnit,
}).annotate({
  identifier: "MealIngredient",
  description: "An amount of a food item used in a meal.",
});
export type MealIngredient = typeof MealIngredient.Type;

/** One meal of a day of a meal plan. */
export const Meal = Schema.Struct({
  slot: MealSlot,
  name: Schema.String,
  description: Schema.String,
  ingredients: Schema.Array(MealIngredient),
}).annotate({
  identifier: "Meal",
  description: "One meal of a day, with its ingredients.",
});
export type Meal = typeof Meal.Type;

/** One day of a meal plan. */
export const MealPlanDay = Schema.Struct({
  /** 1 to 7. */
  day: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: FoodLimits.planDays }),
  ),
  meals: Schema.Array(Meal),
}).annotate({
  identifier: "MealPlanDay",
  description: "One day (1 to 7) of a meal plan, with its meals.",
});
export type MealPlanDay = typeof MealPlanDay.Type;

/** One food item to buy for a meal plan. */
export const ShoppingListEntry = Schema.Struct({
  itemId: FoodItemId,
  name: Schema.String,
  /** What the whole week needs. */
  needed: Quantity,
  /** The packages to buy, 1 or more. */
  packages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** What one package holds. */
  packageQuantity: Quantity,
  /** What the packages cost together. */
  cost: Money,
  /** The price of one package that `cost` is based on. */
  price: FoodPrice,
}).annotate({
  identifier: "ShoppingListEntry",
  description:
    "A food item to buy: the quantity needed, the packages to buy for it, " +
    "what they cost and the price that is based on.",
});
export type ShoppingListEntry = typeof ShoppingListEntry.Type;

/**
 * How far a meal plan is: `pending` (the AI is still writing it), `ready` or
 * `failed` (see `MealPlanFailure`).
 */
export const MealPlanStatus = Schema.Literals([
  "pending",
  "ready",
  "failed",
]).annotate({
  identifier: "MealPlanStatus",
  description:
    "How far a meal plan is: `pending` (still being written), `ready` or " +
    "`failed`.",
});
export type MealPlanStatus = typeof MealPlanStatus.Type;

/**
 * Why no meal plan could be made:
 *
 * - `noCandidates`: too few priced foods fit the country, the diet and the
 *   exclusions.
 * - `overBudget`: the budget is too low.
 * - `invalidPlan`: the planner kept producing plans that break the rules
 *   (unknown foods, wrong amounts, missing meals).
 * - `plannerFailed`: the AI planner could not be reached or answered with an
 *   error.
 *
 * Credits: a plan that failed with `noCandidates`, or with `plannerFailed`
 * because the first request to Claude failed before Claude worked (no
 * connection, a 429 or a 5xx status), cost nothing and give their credit
 * back; `overBudget`, `invalidPlan` and the other `plannerFailed` cases (a
 * refusal, a cut-off answer, a request error, a timeout, an error
 * mid-answer, or any failure after Claude answered once, such as in a
 * retry) keep the credit used. See `createMealPlan`.
 */
export const MealPlanFailureReason = Schema.Literals([
  "noCandidates",
  "overBudget",
  "invalidPlan",
  "plannerFailed",
]).annotate({
  identifier: "MealPlanFailureReason",
  description:
    "Why no meal plan could be made: too few priced foods " +
    "(`noCandidates`), the budget is too low (`overBudget`), the planner " +
    "kept producing invalid plans (`invalidPlan`) or the planner failed " +
    "(`plannerFailed`).",
});
export type MealPlanFailureReason = typeof MealPlanFailureReason.Type;

/** What went wrong with a failed meal plan. */
export const MealPlanFailure = Schema.Struct({
  reason: MealPlanFailureReason,
  /**
   * The least a plan would cost, in the country's currency, when known
   * (`overBudget`); otherwise `null`.
   */
  cheapestTotal: Schema.NullOr(Money),
}).annotate({
  identifier: "MealPlanFailure",
  description:
    "Why a meal plan failed. `cheapestTotal` is the least a plan would " +
    "cost, known for `overBudget` only.",
});
export type MealPlanFailure = typeof MealPlanFailure.Type;

/**
 * A meal plan for a week, with its shopping list and its cost. Plans are
 * written in the background: a new plan is `pending` with no days, no
 * shopping list and no notes, and the cost fields, `model` and `finishedAt`
 * are `null` until it is `ready` (or `failed`, with its `failure`).
 */
export const MealPlan = Schema.Struct({
  id: MealPlanId,
  status: MealPlanStatus,
  /** Set when `failed`; `null` otherwise. */
  failure: Schema.NullOr(MealPlanFailure),
  country: FoodCountry,
  currency: FoodCurrency,
  request: MealPlanRequest,
  /** Empty until `ready`. */
  days: Schema.Array(MealPlanDay),
  /** Empty until `ready`. */
  shoppingList: Schema.Array(ShoppingListEntry),
  /** `null` until `ready`. */
  totalCost: Schema.NullOr(Money),
  /** The percentage of `totalCost` that rests on estimated prices. */
  estimatedShare: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  ),
  /** The accuracy of the prices used, weighted by their cost. */
  accuracy: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  ),
  /** The planner's notes on the plan; empty until `ready`. */
  notes: Schema.String,
  /** The AI model that wrote the plan; `null` until `ready`. */
  model: Schema.NullOr(Schema.String),
  createdAt: IsoDateTimeUtc,
  /** When it became `ready` or `failed`; `null` while `pending`. */
  finishedAt: Schema.NullOr(IsoDateTimeUtc),
}).annotate({
  identifier: "MealPlan",
  description:
    "A meal plan for 7 days with its shopping list. Plans are written in " +
    "the background: `pending` until `ready` or `failed`, and until then " +
    "the days, the shopping list and the notes are empty and `totalCost`, " +
    "`estimatedShare`, `accuracy` and `model` are null. `estimatedShare` " +
    "is the percentage (0 to 100) of `totalCost` based on estimated " +
    "prices, `accuracy` the cost-weighted accuracy (0 to 100) of the " +
    "prices used.",
});
export type MealPlan = typeof MealPlan.Type;

/** A meal plan without its days and shopping list, for lists. */
export const MealPlanSummary = Schema.Struct({
  id: MealPlanId,
  status: MealPlanStatus,
  country: FoodCountry,
  currency: FoodCurrency,
  people: Schema.Int,
  diet: Diet,
  budget: Schema.NullOr(Money),
  /** `null` until `ready`. */
  totalCost: Schema.NullOr(Money),
  /** `null` until `ready`. */
  accuracy: Schema.NullOr(Schema.Int),
  createdAt: IsoDateTimeUtc,
}).annotate({
  identifier: "MealPlanSummary",
  description:
    "A meal plan without its days and shopping list. `budget` is null if " +
    "the request had none; `totalCost` and `accuracy` are null until the " +
    "plan is `ready`.",
});
export type MealPlanSummary = typeof MealPlanSummary.Type;
