import { Effect, Layer, Schedule } from "effect";
import { FoodCommands } from "./FoodCommands.ts";

/**
 * Once an hour, starting at startup: marks plans whose job was lost
 * (pending for longer than `abandonedPlan`) as failed, which gives back
 * the credits they used, and deletes the meal plans of deleted accounts.
 * Account deletion keeps the user's row (a tombstone), so nothing
 * cascades; plans are personal data with no reason to outlive the account,
 * and nobody can read them in between (a deleted account has no session).
 */
export const MealPlanCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* FoodCommands;
    yield* Effect.gen(function* () {
      const failed = yield* commands.failAbandonedPlans;
      if (failed > 0) {
        yield* Effect.logInfo("Abandoned meal plans failed").pipe(
          Effect.annotateLogs({ failed }),
        );
      }
      const deleted = yield* commands.forgetDeletedUsers;
      if (deleted > 0) {
        yield* Effect.logInfo("Meal plans of deleted accounts deleted").pipe(
          Effect.annotateLogs({ deleted }),
        );
      }
    }).pipe(
      // A failed run (database briefly unreachable) must not end the job.
      Effect.catchCause((cause) =>
        Effect.logWarning("Cleaning up meal plans failed", cause),
      ),
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
