import { Effect, Layer, Schedule } from "effect";
import { ContactRetentionConfig } from "#Config";
import { ContactCommands } from "./ContactCommands.ts";

/**
 * Deletes contact messages older than `CONTACT_RETENTION` (90 days by
 * default) once an hour, starting at startup: they hold names, addresses and
 * free text, which are kept only as long as an answer might still be due.
 */
export const ContactCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* ContactCommands;
    const retention = yield* ContactRetentionConfig;
    yield* commands.purgeOlderThan(retention).pipe(
      Effect.tap((deleted) =>
        deleted > 0
          ? Effect.logInfo("Old contact messages deleted").pipe(
              Effect.annotateLogs({ deleted }),
            )
          : Effect.void,
      ),
      // A failed run (database briefly unreachable) must not end the job.
      Effect.catchCause((cause) =>
        Effect.logWarning("Deleting old contact messages failed", cause),
      ),
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
