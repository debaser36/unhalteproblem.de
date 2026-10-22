import type {
  Diet,
  FoodImport,
  FoodImportId,
  FoodItem,
  FoodItemDetails,
  FoodItemId,
  FoodPrice,
  MealPlan,
  MealPlanId,
  MealPlanSummary,
} from "@unhalteproblem.de/api";
import { FoodLimits } from "@unhalteproblem.de/api";
import { DateTime } from "effect";
import { abandonedPlan } from "#domains/food/FoodCommands";
import type { ImportRow } from "#domains/food/FoodImportRepository";
import type { ItemWithPrices } from "#domains/food/FoodQueries";
import type { PlanRow } from "#domains/food/MealPlanRepository";
import { asOf, bestPrice, type Price } from "#domains/food/Pricing";

/** The food planner's rows in the contract's shapes. */

const toFoodPrice = (price: Price): FoodPrice => ({
  amount: price.amount,
  currency: price.currency,
  source: price.source,
  accuracy: price.accuracy,
  observedOn: price.observedOn,
  where: price.where,
  discounted: price.discounted,
});

export const toFoodItem = ({
  item,
  prices,
  today,
}: ItemWithPrices): FoodItem => {
  const best = bestPrice(prices, today);
  return {
    id: item.id as FoodItemId,
    country: item.country,
    source: item.source,
    sourceRef: item.sourceRef,
    name: item.name,
    brand: item.brand,
    quantity:
      item.quantityAmount === null || item.quantityUnit === null
        ? null
        : { amount: item.quantityAmount, unit: item.quantityUnit },
    vegetarian: item.vegetarian,
    vegan: item.vegan,
    categories: item.categories,
    allergens: item.allergens,
    bestPrice: best === undefined ? null : toFoodPrice(best),
  };
};

export const toFoodItemDetails = (found: ItemWithPrices): FoodItemDetails => ({
  ...toFoodItem(found),
  ingredients: found.item.ingredients,
  // Stored newest first; each with its accuracy for today.
  prices: found.prices
    .slice(0, FoodLimits.maxPrices)
    .map((price) => toFoodPrice(asOf(price, found.today))),
  updatedAt: found.item.updatedAt,
});

export const toFoodImport = (row: ImportRow): FoodImport => ({
  id: row.id as FoodImportId,
  country: row.country,
  source: row.source,
  status: row.status,
  requestedAt: row.requestedAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  items: row.items,
  prices: row.prices,
  error: row.error,
});

/**
 * A pending plan whose job is gone (see `abandonedPlan`) as what it is for
 * the user: failed.
 */
const settled = (row: PlanRow, now: DateTime.Utc): PlanRow =>
  row.status === "pending" &&
  DateTime.isLessThan(DateTime.addDuration(row.createdAt, abandonedPlan), now)
    ? {
        ...row,
        status: "failed",
        failureReason: "plannerFailed",
        finishedAt: DateTime.addDuration(row.createdAt, abandonedPlan),
      }
    : row;

export const toMealPlan = (stored: PlanRow, now: DateTime.Utc): MealPlan => {
  const row = settled(stored, now);
  return {
    id: row.id as MealPlanId,
    status: row.status,
    failure:
      row.status === "failed" && row.failureReason !== null
        ? { reason: row.failureReason, cheapestTotal: row.cheapestTotal }
        : null,
    country: row.country,
    currency: row.currency,
    request: row.request,
    days: row.plan?.days ?? [],
    shoppingList: row.plan?.shoppingList ?? [],
    totalCost: row.totalCost,
    estimatedShare: row.estimatedShare,
    accuracy: row.accuracy,
    notes: row.plan?.notes ?? "",
    model: row.model,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
};

export const toMealPlanSummary = (
  stored: PlanRow,
  now: DateTime.Utc,
): MealPlanSummary => {
  const row = settled(stored, now);
  return {
    id: row.id as MealPlanId,
    status: row.status,
    country: row.country,
    currency: row.currency,
    people: row.request.people,
    diet: row.request.diet satisfies Diet,
    budget: row.request.budget ?? null,
    totalCost: row.totalCost,
    accuracy: row.accuracy,
    createdAt: row.createdAt,
  };
};
