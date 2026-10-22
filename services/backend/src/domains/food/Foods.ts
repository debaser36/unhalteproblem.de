import { Layer } from "effect";
import { FoodCommands } from "./FoodCommands.ts";
import { FoodImporter } from "./FoodImporter.ts";
import { FoodImportRepository } from "./FoodImportRepository.ts";
import { FoodJobs } from "./FoodJobs.ts";
import { FoodQueries } from "./FoodQueries.ts";
import { MealPlanCleanup } from "./MealPlanCleanup.ts";
import { FoodRepository } from "./FoodRepository.ts";
import { MealPlanRepository } from "./MealPlanRepository.ts";

const Repositories = Layer.mergeAll(
  FoodRepository.layer,
  FoodImportRepository.layer,
  MealPlanRepository.layer,
);

/**
 * The food domain: provides `FoodCommands` and `FoodQueries` and runs the
 * background jobs and the cleanup of deleted accounts' plans. Needs a migrated `SqlClient`, `Transaction`, `Outbox`,
 * `UserDirectory`, and the sources: `OpenPrices`, `OpenFoodFacts`,
 * `StatsNz` and `Claude`.
 */
export const FoodLive = Layer.mergeAll(FoodJobs, MealPlanCleanup).pipe(
  Layer.provideMerge(Layer.mergeAll(FoodCommands.layer, FoodQueries.layer)),
  Layer.provideMerge(FoodImporter.layer),
  Layer.provide(Repositories),
);
