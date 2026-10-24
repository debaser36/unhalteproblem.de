import {
  Authorized,
  type FoodDataSource,
  FoodLimits,
  type FoodItemQuery,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import {
  dataSources,
  FoodImportNotFound,
  FoodItemNotFound,
  MealPlanNotFound,
  planning,
} from "./Food.ts";
import {
  FoodImportRepository,
  type ImportRow,
} from "./FoodImportRepository.ts";
import { FoodRepository, type ItemRow } from "./FoodRepository.ts";
import { MealPlanRepository, type PlanRow } from "./MealPlanRepository.ts";
import type { Price } from "./Pricing.ts";

/** An item with its stored prices (newest first) and the day they are judged on. */
export interface ItemWithPrices {
  readonly item: ItemRow;
  readonly prices: ReadonlyArray<Price>;
  readonly today: string;
}

/** Plans listed per user. */
const planListLimit = 100;

/** The words of a search term, at most 10. */
const wordsOf = (q: string | undefined): ReadonlyArray<string> =>
  (q ?? "")
    .split(/\s+/u)
    .filter((word) => word !== "")
    .slice(0, 10);

const make = Effect.gen(function* () {
  const foods = yield* FoodRepository;
  const imports = yield* FoodImportRepository;
  const plans = yield* MealPlanRepository;
  const users = yield* UserDirectory;

  const actor = Effect.flatMap(Authorized(...planning), (proof) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users)),
  );
  const today = Effect.map(DateTime.now, DateTime.formatIsoDateUtc);

  return FoodQueries.of({
    sources: Authorized("foodPlanner").pipe(Effect.as(dataSources)),

    search: Effect.fn("FoodQueries.search")(function* (query: FoodItemQuery) {
      yield* Authorized(...planning);
      const items = yield* foods.search({
        country: query.country,
        words: wordsOf(query.q),
        diet: query.diet ?? "omnivore",
        priced: query.priced ?? null,
        limit: query.limit ?? FoodLimits.defaultLimit,
        offset: query.offset ?? 0,
      });
      const prices = yield* foods.pricesOf(items.map((item) => item.id));
      const day = yield* today;
      return items.map((item): ItemWithPrices => ({
        item,
        prices: prices.get(item.id) ?? [],
        today: day,
      }));
    }, Query.boundary),

    item: Effect.fn("FoodQueries.item")(function* (id: string) {
      yield* Authorized(...planning);
      const item = yield* foods.find(id);
      if (Option.isNone(item)) return yield* new FoodItemNotFound({ item: id });
      const prices = yield* foods.pricesOf([id]);
      return {
        item: item.value,
        prices: prices.get(id) ?? [],
        today: yield* today,
      } satisfies ItemWithPrices;
    }, Query.boundary),

    imports: Authorized("foodPlanner").pipe(
      Effect.andThen(imports.list(FoodLimits.maxImports)),
      Query.boundary,
      Effect.withSpan("FoodQueries.imports"),
    ),

    import: Effect.fn("FoodQueries.import")(function* (id: string) {
      yield* Authorized("foodPlanner");
      const row = yield* imports.find(id);
      if (Option.isNone(row))
        return yield* new FoodImportNotFound({ importId: id });
      return row.value;
    }, Query.boundary),

    mealPlans: Effect.gen(function* () {
      const by = yield* actor;
      return yield* plans.listOf(by, planListLimit);
    }).pipe(Query.boundary, Effect.withSpan("FoodQueries.mealPlans")),

    mealPlan: Effect.fn("FoodQueries.mealPlan")(function* (id: string) {
      const by = yield* actor;
      const plan = yield* plans.findOf(id, by);
      // Someone else's plan is as missing as one that never existed.
      if (Option.isNone(plan)) return yield* new MealPlanNotFound({ plan: id });
      return plan.value;
    }, Query.boundary),
  });
});

type Planning = Authorized<(typeof planning)[number]>;

/**
 * The reads of the food planner: the sources and imports require
 * `foodPlanner`, the food items and meal plans `foodPlanner` or
 * `mealPlanBuyer` (`planning`). Meal plans are only ever the caller's own.
 *
 * @effect-expect-leaking Authorized<"foodPlanner"> | Authorized<"foodPlanner" | "mealPlanBuyer">
 */
export class FoodQueries extends Context.Service<
  FoodQueries,
  {
    readonly sources: Effect.Effect<
      ReadonlyArray<FoodDataSource>,
      never,
      Authorized<"foodPlanner">
    >;
    readonly search: (
      query: FoodItemQuery,
    ) => Effect.Effect<ReadonlyArray<ItemWithPrices>, never, Planning>;
    readonly item: (
      id: string,
    ) => Effect.Effect<ItemWithPrices, FoodItemNotFound, Planning>;
    /** The newest imports first. */
    readonly imports: Effect.Effect<
      ReadonlyArray<ImportRow>,
      never,
      Authorized<"foodPlanner">
    >;
    readonly import: (
      id: string,
    ) => Effect.Effect<
      ImportRow,
      FoodImportNotFound,
      Authorized<"foodPlanner">
    >;
    /** The caller's plans, newest first. */
    readonly mealPlans: Effect.Effect<ReadonlyArray<PlanRow>, never, Planning>;
    /** One of the caller's plans. */
    readonly mealPlan: (
      id: string,
    ) => Effect.Effect<PlanRow, MealPlanNotFound, Planning>;
  }
>()("@unhalteproblem.de/backend/domains/food/FoodQueries") {
  /** Needs the food repositories and `UserDirectory`. */
  static readonly layer = Layer.effect(FoodQueries, make);
}
