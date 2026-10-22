import { Effect, Layer, Schedule } from "effect";
import { LoginAttempts } from "./LoginAttempts.ts";
import { LogoutTokens } from "./LogoutTokens.ts";
import { Sessions } from "./Sessions.ts";

/**
 * Deletes expired login attempts, sessions and remembered logout token ids
 * every 10 minutes. Expired rows are never used (every read checks
 * `expires_at`), so this only keeps the tables small.
 */
export const AuthCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const loginAttempts = yield* LoginAttempts;
    const sessions = yield* Sessions;
    const logoutTokens = yield* LogoutTokens;

    yield* Effect.all({
      loginAttempts: loginAttempts.deleteExpired,
      sessions: sessions.deleteExpired,
      logoutTokens: logoutTokens.deleteExpired,
    }).pipe(
      Effect.tap((deleted) =>
        Effect.logDebug("Expired auth rows deleted", deleted),
      ),
      // A failed run (database briefly unreachable) must not end the job.
      Effect.catchCause((cause) =>
        Effect.logWarning("Deleting expired auth rows failed", cause),
      ),
      Effect.repeat(Schedule.spaced("10 minutes")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
