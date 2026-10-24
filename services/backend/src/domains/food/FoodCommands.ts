import {
  Authorized,
  currencyOfCountry,
  FoodImportId,
  type FoodCountry,
  type MealPlanRequest,
  type StartFoodImportPayload,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Duration, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import { Outbox } from "#cqrs/Outbox";
import * as Query from "#cqrs/Query";
import { Transaction } from "#cqrs/Transaction";
import { CreditCommands } from "#domains/credits/CreditCommands";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { Claude } from "#infrastructure/Claude";
import { isUniqueViolation } from "#infrastructure/Columns";
import {
  FoodImportAlreadyRunning,
  FoodImportNotSupported,
  MealPlannerUnavailable,
  MealPlanNotFound,
  mealPlanLimits,
  type NoCreditsLeft,
  planning,
  RateLimited,
  RunFoodImport,
  WriteMealPlan,
} from "./Food.ts";
import { FoodImporter, supports } from "./FoodImporter.ts";
import {
  activeImportConstraint,
  FoodImportRepository,
  type ImportRow,
} from "./FoodImportRepository.ts";
import { MealPlanRepository, type PlanRow } from "./MealPlanRepository.ts";

/**
 * An import of the same kind still queued or running after this long has
 * lost its worker (the outbox gave up on it): it is marked failed, so that
 * a new one can start. Longer than an import can live: three attempts of
 * up to an hour each, plus the pauses between them.
 */
const staleImport = Duration.hours(4);

/**
 * A plan still pending after this long has lost its job (the outbox gave
 * up on it): it no longer counts against the user's pending plans, and the
 * API shows it as failed.
 */
export const abandonedPlan = Duration.hours(1);

const make = Effect.gen(function* () {
  const imports = yield* FoodImportRepository;
  const plans = yield* MealPlanRepository;
  const importer = yield* FoodImporter;
  const users = yield* UserDirectory;
  const outbox = yield* Outbox;
  const claude = yield* Claude;
  const credits = yield* CreditCommands;
  const transaction = yield* Transaction;

  const actorOf = (proof: { readonly user: { readonly id: string } }) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users));
  const actor = Effect.flatMap(Authorized("foodPlanner"), actorOf);

  return FoodCommands.of({
    startImport: Effect.fn("FoodCommands.startImport")(function* (
      payload: StartFoodImportPayload,
    ) {
      const by = yield* actor;
      if (!supports(payload.country, payload.source)) {
        return yield* new FoodImportNotSupported(payload);
      }
      const now = yield* DateTime.now;
      yield* imports.failStale(
        payload.country,
        payload.source,
        DateTime.subtractDuration(now, staleImport),
        now,
      );
      const row: ImportRow = {
        id: crypto.randomUUID(),
        country: payload.country,
        source: payload.source,
        status: "queued",
        requestedBy: by,
        requestedAt: now,
        startedAt: null,
        finishedAt: null,
        items: 0,
        prices: 0,
        error: null,
      };
      // Another import of the same kind fails the insert; inside a
      // savepoint that rolls back only the statement.
      yield* transaction.run(imports.insert(row)).pipe(
        Effect.catchIf(isUniqueViolation(activeImportConstraint), () =>
          Effect.gen(function* () {
            const active = yield* imports.findActive(
              payload.country,
              payload.source,
            );
            if (Option.isSome(active)) {
              return yield* new FoodImportAlreadyRunning({
                importId: FoodImportId.make(active.value.id),
              });
            }
            // It finished in between: this one can go ahead after all.
            yield* transaction.run(imports.insert(row));
          }),
        ),
      );
      yield* outbox.enqueue(RunFoodImport, { importId: row.id });
      return row;
    }, Command.boundary(transaction)),

    lookup: Effect.fn("FoodCommands.lookup")(function* (
      term: string,
      country: FoodCountry,
    ) {
      yield* Authorized("foodPlanner");
      // The search answers from what is stored either way; a lookup that
      // fails only means nothing new was found.
      yield* importer
        .lookup(term, country)
        .pipe(
          Effect.catchTag("OpenFoodFactsFailed", (error) =>
            Effect.logWarning("Open Food Facts lookup failed", error).pipe(
              Effect.as(0),
            ),
          ),
        );
    }, Query.boundary),

    createMealPlan: Effect.fn("FoodCommands.createMealPlan")(function* (
      request: MealPlanRequest,
    ) {
      const proof = yield* Authorized(...planning);
      const by = yield* actorOf(proof);
      if (!claude.configured) return yield* new MealPlannerUnavailable();
      // Requests of the same user wait for each other here, so that the
      // limits below can't be passed by sending several at once.
      yield* users.lockForUpdate([by]);
      const now = yield* DateTime.now;
      const recent = yield* plans.recent(
        by,
        DateTime.subtractDuration(now, Duration.days(1)),
        DateTime.subtractDuration(now, abandonedPlan),
      );
      if (
        recent.total >= mealPlanLimits.perDay ||
        recent.pending >= mealPlanLimits.pending
      ) {
        return yield* new RateLimited();
      }
      const id = crypto.randomUUID();
      // Without `foodPlanner`, a plan costs a credit; it comes back only if the
      // plan fails at no cost (FoodJobs, failAbandonedPlans, deleteMealPlan).
      if (!proof.roles.includes("foodPlanner")) {
        yield* credits.consume(by, "mealPlan", id);
      }
      const currency = currencyOfCountry[request.country];
      yield* plans.insert({
        id,
        userId: by,
        country: request.country,
        currency,
        request,
        createdAt: now,
      });
      yield* outbox.enqueue(WriteMealPlan, { planId: id });
      return {
        id,
        userId: by,
        status: "pending",
        failureReason: null,
        cheapestTotal: null,
        country: request.country,
        currency,
        request,
        plan: null,
        totalCost: null,
        estimatedShare: null,
        accuracy: null,
        model: null,
        createdAt: now,
        finishedAt: null,
      } satisfies PlanRow;
    }, Command.boundary(transaction)),

    deleteMealPlan: Effect.fn("FoodCommands.deleteMealPlan")(function* (
      id: string,
    ) {
      const by = yield* actorOf(yield* Authorized(...planning));
      const removed = yield* plans.remove(id, by);
      if (Option.isNone(removed))
        return yield* new MealPlanNotFound({ plan: id });
      // A plan deleted before its job started cost nothing. Once Claude was
      // asked the credit stays used, also for a failed or written plan (a
      // failure that cost nothing gave it back already).
      if (removed.value.status === "pending" && !removed.value.started) {
        yield* credits.release("mealPlan", id);
      }
    }, Command.boundary(transaction)),

    failAbandonedPlans: Effect.gen(function* () {
      const now = yield* DateTime.now;
      const failed = yield* plans.failAbandoned(
        DateTime.subtractDuration(now, abandonedPlan),
        now,
      );
      // Only a plan whose job never started cost nothing.
      for (const plan of failed) {
        if (!plan.started) yield* credits.release("mealPlan", plan.id);
      }
      return failed.length;
    }).pipe(
      Command.boundary(transaction),
      Effect.withSpan("FoodCommands.failAbandonedPlans"),
    ),

    forgetDeletedUsers: plans.removeOfDeletedUsers.pipe(
      Command.boundary(transaction),
      Effect.withSpan("FoodCommands.forgetDeletedUsers"),
    ),
  });
});

type Planning = Authorized<(typeof planning)[number]>;

/**
 * The changes of the food planner. Imports and lookups require
 * `foodPlanner`; meal plans `foodPlanner` or `mealPlanBuyer` (`planning`). The
 * cleanups (`failAbandonedPlans`, `forgetDeletedUsers`) require nothing.
 *
 * @effect-expect-leaking Authorized<"foodPlanner"> | Authorized<"foodPlanner" | "mealPlanBuyer">
 */
export class FoodCommands extends Context.Service<
  FoodCommands,
  {
    /** Queues an import; a background job runs it (`FoodJobs`). */
    readonly startImport: (
      payload: StartFoodImportPayload,
    ) => Effect.Effect<
      ImportRow,
      FoodImportNotSupported | FoodImportAlreadyRunning,
      Authorized<"foodPlanner">
    >;
    /**
     * Looks `term` up on Open Food Facts and stores the products found, for
     * a search with `lookup`. Never fails: a failed lookup is logged.
     */
    readonly lookup: (
      term: string,
      country: FoodCountry,
    ) => Effect.Effect<void, never, Authorized<"foodPlanner">>;
    /**
     * Stores a pending plan for the user; a background job writes it.
     * Without `foodPlanner` it uses one of the user's meal-plan credits
     * (`NoCreditsLeft` without one), which comes back only if the plan fails
     * before Claude cost anything (see `FoodJobs`).
     */
    readonly createMealPlan: (
      request: MealPlanRequest,
    ) => Effect.Effect<
      PlanRow,
      MealPlannerUnavailable | RateLimited | NoCreditsLeft,
      Planning
    >;
    /**
     * Deletes one of the user's own plans. A plan deleted before its job
     * started gives its credit back.
     */
    readonly deleteMealPlan: (
      id: string,
    ) => Effect.Effect<void, MealPlanNotFound, Planning>;
    /**
     * Marks plans pending for longer than `abandonedPlan` as failed (their
     * job is lost) and gives back the credits of those whose job never
     * started; how many. No role check:
     * run by `MealPlanCleanup`.
     */
    readonly failAbandonedPlans: Effect.Effect<number>;
    /**
     * Deletes the meal plans of deleted accounts; how many. No role check:
     * run by `MealPlanCleanup`.
     */
    readonly forgetDeletedUsers: Effect.Effect<number>;
  }
>()("@unhalteproblem.de/backend/domains/food/FoodCommands") {
  /**
   * Needs the food repositories, `FoodImporter`, `UserDirectory`,
   * `CreditCommands`, `Outbox`, `Claude` and `Transaction`.
   */
  static readonly layer = Layer.effect(FoodCommands, make);
}
