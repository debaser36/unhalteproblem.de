import { Api } from "@unhalteproblem.de/api";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { FoodCommands } from "#domains/food/FoodCommands";
import { FoodQueries } from "#domains/food/FoodQueries";
import { noStore } from "./CacheControl.ts";
import {
  toFoodImport,
  toFoodItem,
  toFoodItemDetails,
  toMealPlan,
  toMealPlanSummary,
} from "./FoodViews.ts";

/**
 * The food planner. The group's `RequireFoodPlanner` provides the proof the
 * commands and queries require.
 */
export const FoodPlannerHandlers = HttpApiBuilder.group(
  Api,
  "foodPlanner",
  Effect.fn(function* (handlers) {
    const commands = yield* FoodCommands;
    const queries = yield* FoodQueries;
    return handlers
      .handle("listFoodSources", () => queries.sources.pipe(noStore))
      .handle("searchFoodItems", ({ query }) =>
        Effect.gen(function* () {
          if (query.lookup === true && query.q !== undefined) {
            yield* commands.lookup(query.q, query.country);
          }
          const items = yield* queries.search(query);
          return { items: items.map(toFoodItem) };
        }).pipe(noStore),
      )
      .handle("getFoodItem", ({ params }) =>
        queries
          .item(params.itemId)
          .pipe(Effect.map(toFoodItemDetails), noStore),
      )
      .handle("listFoodImports", () =>
        queries.imports.pipe(
          Effect.map((rows) => rows.map(toFoodImport)),
          noStore,
        ),
      )
      .handle("startFoodImport", ({ payload }) =>
        commands.startImport(payload).pipe(Effect.map(toFoodImport), noStore),
      )
      .handle("getFoodImport", ({ params }) =>
        queries.import(params.importId).pipe(Effect.map(toFoodImport), noStore),
      )
      .handle("createMealPlan", ({ payload }) =>
        Effect.gen(function* () {
          const row = yield* commands.createMealPlan(payload);
          return toMealPlan(row, yield* DateTime.now);
        }).pipe(noStore),
      )
      .handle("listMealPlans", () =>
        Effect.gen(function* () {
          const rows = yield* queries.mealPlans;
          const now = yield* DateTime.now;
          return rows.map((row) => toMealPlanSummary(row, now));
        }).pipe(noStore),
      )
      .handle("getMealPlan", ({ params }) =>
        Effect.gen(function* () {
          const row = yield* queries.mealPlan(params.planId);
          return toMealPlan(row, yield* DateTime.now);
        }).pipe(noStore),
      )
      .handle("deleteMealPlan", ({ params }) =>
        commands.deleteMealPlan(params.planId).pipe(noStore),
      );
  }),
);
