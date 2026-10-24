import type { FoodDataSource } from "@unhalteproblem.de/api";
import { Schema } from "effect";
import * as Outbox from "#cqrs/Outbox";

/**
 * The food planner: food data and prices for Germany and New Zealand from
 * open sources, imported on request, and weekly meal plans that Claude
 * writes from the priced foods. The imports require the `foodPlanner`
 * role; the food data and meal plans `foodPlanner` or `mealPlanBuyer` (who
 * pays a credit per plan). See docs/food.md.
 */

/**
 * The roles that may search the food data and request and read their own
 * meal plans: `foodPlanner` (unlimited) or `mealPlanBuyer` (one credit per
 * plan), as `Authorized(...planning)`.
 */
export const planning = ["foodPlanner", "mealPlanBuyer"] as const;

// Errors: the contract's, so they map to their status codes as they are.
export {
  FoodImportAlreadyRunning,
  FoodImportNotFound,
  FoodImportNotSupported,
  FoodItemNotFound,
  MealPlannerUnavailable,
  MealPlanNotFound,
  NoCreditsLeft,
  RateLimited,
} from "@unhalteproblem.de/api";

/** Runs a requested import in the background. */
export const RunFoodImport = Outbox.topic(
  "food.run-import",
  Schema.Struct({ importId: Schema.String }),
);

/** Writes a requested meal plan in the background. */
export const WriteMealPlan = Outbox.topic(
  "food.write-meal-plan",
  Schema.Struct({ planId: Schema.String }),
);

/**
 * Meal plans one user may request per day, and have pending at once. Each
 * plan costs a Claude request of a few cents up to about a dollar.
 */
export const mealPlanLimits = { perDay: 20, pending: 2 } as const;

/** Where the data comes from, with the attribution the licences ask for. */
export const dataSources: ReadonlyArray<FoodDataSource> = [
  {
    id: "openFoodFacts",
    name: "Open Food Facts",
    url: "https://world.openfoodfacts.org",
    licence:
      "Open Database License (ODbL) 1.0; contents: Database Contents License",
    countries: ["DE", "NZ"],
    note: "Products: names, packages, categories, ingredients, allergens and whether they are vegetarian or vegan.",
  },
  {
    id: "openPrices",
    name: "Open Prices (Open Food Facts)",
    url: "https://prices.openfoodfacts.org",
    licence: "Open Database License (ODbL) 1.0",
    countries: ["DE", "NZ"],
    note: "Prices people recorded in shops. Germany has a few thousand a year, mostly in Berlin and Munich; New Zealand almost none.",
  },
  {
    id: "statsNz",
    name: "Stats NZ, Selected Monthly Weighted Average Prices",
    url: "https://www.stats.govt.nz/topics/food-price-index",
    licence: "Creative Commons Attribution 4.0 International",
    countries: ["NZ"],
    note: "About 150 food items, monthly. Indicative averages over supermarkets and other shops in 12 urban areas.",
  },
  {
    id: "estimate",
    name: "Claude (Anthropic)",
    url: "https://www.anthropic.com",
    licence: "Generated estimates",
    countries: ["DE", "NZ"],
    note: "Estimated prices for foods without a recorded one, at an accuracy of at most 40%. Meal plans are written by Claude as well.",
  },
];
