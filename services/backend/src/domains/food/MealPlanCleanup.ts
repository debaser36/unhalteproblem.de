import { Effect, Layer, Schedule } from "effect";
import { FoodCommands } from "./FoodCommands.ts";

/**
 * Deletes the meal plans of deleted accounts once an hour, starting at
 * startup. Account deletion keeps the user's row (a tombstone), so nothing
 * cascades; plans are personal data with no reason to outlive the account,
 * and nobody can read them in between (a deleted account has no session).
 */
export const MealPlanCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* FoodCommands;
    yield* commands.forgetDeletedUsers.pipe(
      Effect.tap((deleted) =>
        deleted > 0
          ? Effect.logInfo("Meal plans of deleted accounts deleted").pipe(
              Effect.annotateLogs({ deleted }),
            )
          : Effect.void,
      ),
      // A failed run (database briefly unreachable) must not end the job.
      Effect.catchCause((cause) =>
        Effect.logWarning(
          "Deleting meal plans of deleted accounts failed",
          cause,
        ),
      ),
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
