import type { FoodItemId, MealPlanRequest } from "@unhalteproblem.de/api";
import { Cause, DateTime, Duration, Effect, Layer, Option } from "effect";
import * as Outbox from "#cqrs/Outbox";
import * as Query from "#cqrs/Query";
import { exclusionMatcher, isGrocery } from "./Classification.ts";
import { RunFoodImport, WriteMealPlan } from "./Food.ts";
import { FoodImporter } from "./FoodImporter.ts";
import { FoodImportRepository } from "./FoodImportRepository.ts";
import { FoodRepository } from "./FoodRepository.ts";
import * as MealPlanner from "./MealPlanner.ts";
import { MealPlanRepository, type StoredPlan } from "./MealPlanRepository.ts";
import { bestPrice } from "./Pricing.ts";

/**
 * The background work of the food planner, as outbox consumers: running a
 * requested import and writing a requested meal plan. Both record their
 * outcome on their row (`food_imports`, `meal_plans`), which is what the
 * API shows. A failure of the work itself is an outcome, not a reason to
 * try again; only a crash of the process (or the database during the last
 * write) makes the outbox retry.
 */

/** How long an import may run; past it, it is recorded as failed. */
export const importTimeout = Duration.minutes(50);
/** The reservation of an import's message: longer than the timeout, so the
 * outcome is recorded before anyone else takes the message. */
const importLease = Duration.hours(1);
/** The longest a plan may take: up to three Claude requests. */
const planLease = Duration.minutes(20);

const runImport = Effect.fn("FoodJobs.runImport")(function* ({
  importId,
}: {
  readonly importId: string;
}) {
  const imports = yield* FoodImportRepository;
  const importer = yield* FoodImporter;
  const started = yield* imports.start(importId, yield* DateTime.now);
  if (Option.isNone(started)) return;
  const { country, source } = started.value;
  const result = yield* importer.run(country, source).pipe(
    Effect.map((counts) => ({
      status: "succeeded" as const,
      ...counts,
      error: null,
    })),
    Effect.catchTags({
      OpenPricesFailed: (error) => failed(error),
      OpenFoodFactsFailed: (error) => failed(error),
      StatsNzFailed: (error) => failed(error),
      ClaudeFailed: (error) => failed(error),
    }),
    // Database trouble or a bug: an outcome as well, so that the import
    // does not stay `running`. Interruptions (the timeout, a shutdown) pass.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logError("Food import crashed", cause).pipe(
            Effect.as(outcome("crashed")),
          ),
    ),
    Effect.timeoutOrElse({
      duration: importTimeout,
      orElse: () => Effect.succeed(outcome("timeout")),
    }),
  );
  yield* imports.finish({ id: importId, now: yield* DateTime.now, ...result });
}, Query.boundary);

const outcome = (error: string) => ({
  status: "failed" as const,
  items: 0,
  prices: 0,
  error: error.slice(0, 200),
});

const failed = (error: { readonly _tag: string; readonly reason: string }) =>
  Effect.logWarning("Food import failed", error).pipe(
    Effect.as(outcome(`${error._tag}:${error.reason}`)),
  );

/** The foods a plan for `request` may use, with the price to plan with. */
const candidatesFor = Effect.fnUntraced(function* (request: MealPlanRequest) {
  const foods = yield* FoodRepository;
  const rows = yield* foods.candidates(request.country, request.diet);
  const prices = yield* foods.pricesOf(rows.map((row) => row.id));
  const today = DateTime.formatIsoDateUtc(yield* DateTime.now);
  const isExcluded = exclusionMatcher(request.exclude ?? []);
  return rows.flatMap((row): ReadonlyArray<MealPlanner.Candidate> => {
    const price = bestPrice(prices.get(row.id) ?? [], today);
    if (
      price === undefined ||
      row.quantityAmount === null ||
      row.quantityUnit === null ||
      !isGrocery(row.name) ||
      isExcluded(row)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        name: row.name,
        brand: row.brand,
        package: { amount: row.quantityAmount, unit: row.quantityUnit },
        price,
        vegetarian: row.vegetarian,
        vegan: row.vegan,
        categories: row.categories,
        generic: row.source !== "openFoodFacts",
      },
    ];
  });
});

/** The plan in the contract's shapes, as `meal_plans.plan` stores it. */
const stored = (plan: MealPlanner.Plan): StoredPlan => ({
  days: plan.days.map((day) => ({
    day: day.day,
    meals: day.meals.map((meal) => ({
      slot: meal.slot,
      name: meal.name,
      description: meal.description,
      ingredients: meal.ingredients.map((ingredient) => ({
        itemId: ingredient.food.id as FoodItemId,
        name: ingredient.food.name,
        amount: ingredient.amount,
        unit: ingredient.food.package.unit,
      })),
    })),
  })),
  shoppingList: plan.shopping.lines.map((line) => ({
    itemId: line.food.id as FoodItemId,
    name: line.food.name,
    needed: { amount: line.needed, unit: line.food.package.unit },
    packages: line.packages,
    packageQuantity: line.food.package,
    cost: line.cost,
    price: line.food.price,
  })),
  notes: plan.notes,
});

const writeMealPlan = Effect.fn("FoodJobs.writeMealPlan")(function* ({
  planId,
}: {
  readonly planId: string;
}) {
  const plans = yield* MealPlanRepository;
  const row = yield* plans.find(planId);
  // Deleted, or written already by an earlier run.
  if (Option.isNone(row) || row.value.status !== "pending") return;
  // Nothing goes to Claude for an account that was deleted or restricted
  // in the meantime, or that lost the role.
  if (!(yield* plans.ownerMayPlan(planId))) {
    yield* Effect.logInfo("Meal plan dropped: its owner may not plan").pipe(
      Effect.annotateLogs({ planId }),
    );
    yield* plans.fail({
      id: planId,
      reason: "plannerFailed",
      cheapestTotal: null,
      now: yield* DateTime.now,
    });
    return;
  }
  const { request } = row.value;
  const candidates = yield* candidatesFor(request);
  const outcome = yield* MealPlanner.plan(
    {
      country: request.country,
      people: request.people,
      meals: request.meals,
      diet: request.diet,
      budget: request.budget ?? null,
      exclude: request.exclude ?? [],
      preferences: request.preferences ?? "",
    },
    candidates,
  ).pipe(
    Effect.catchTag("ClaudeFailed", (error) =>
      Effect.logWarning("Meal plan failed: Claude", error).pipe(
        Effect.as({
          _tag: "Failed" as const,
          failure: { reason: "plannerFailed", cheapestTotal: null } as const,
        }),
      ),
    ),
  );
  const now = yield* DateTime.now;
  if (outcome._tag === "Failed") {
    yield* plans.fail({ id: planId, ...outcome.failure, now });
    return;
  }
  yield* plans.complete({
    id: planId,
    plan: stored(outcome.plan),
    totalCost: outcome.plan.shopping.total,
    estimatedShare: outcome.plan.shopping.estimatedShare,
    accuracy: outcome.plan.shopping.accuracy,
    model: outcome.plan.model,
    now,
  });
}, Query.boundary);

/**
 * The consumers, one message at a time each, with leases longer than the
 * slowest run. Needs `Outbox`, the food repositories, `FoodImporter` and
 * `Claude`.
 */
export const FoodJobs = Layer.mergeAll(
  Outbox.consumer(RunFoodImport, runImport, {
    batchSize: 1,
    lease: importLease,
    maxAttempts: 3,
  }),
  Outbox.consumer(WriteMealPlan, writeMealPlan, {
    batchSize: 1,
    lease: planLease,
    maxAttempts: 2,
  }),
);
