import { Effect, Layer, Schedule } from "effect";
import { AuditRetentionConfig } from "#Config";
import { AuditCommands } from "./AuditCommands.ts";

/**
 * Deletes audit entries older than `AUDIT_RETENTION` (a year by default)
 * once a day, starting at startup.
 */
export const AuditCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* AuditCommands;
    const retention = yield* AuditRetentionConfig;
    yield* commands.purgeOlderThan(retention).pipe(
      Effect.tap((deleted) =>
        deleted > 0
          ? Effect.logInfo("Old audit entries deleted").pipe(
              Effect.annotateLogs({ deleted }),
            )
          : Effect.void,
      ),
      // A failed run (database briefly unreachable) must not end the job.
      Effect.catchCause((cause) =>
        Effect.logWarning("Deleting old audit entries failed", cause),
      ),
      Effect.repeat(Schedule.spaced("1 day")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
