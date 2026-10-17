import {
  Authentication,
  CurrentUser,
  type SessionInfo,
  Unauthorized,
} from "@unhalteproblem.de/api";
import { Effect, Layer, Option, Redacted } from "effect";
import { hashSecret } from "#auth/Secrets";
import { type Session, Sessions } from "#repositories/Sessions";

/** What the website learns about a session (`GET /auth/session`). */
export const toSessionInfo = (session: Session): SessionInfo => {
  const { preferred_username, name, email, email_verified } = session.claims;
  return {
    user: {
      id: session.userId,
      ...(preferred_username === undefined
        ? {}
        : { username: preferred_username }),
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(email_verified === undefined
        ? {}
        : { emailVerified: email_verified }),
    },
    expiresAt: session.expiresAt,
  };
};

/**
 * Resolves the `__Host-session` cookie to an unexpired session and provides
 * it as `CurrentUser`; anything else is `Unauthorized`.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    return Authentication.of({
      session: (httpEffect, { credential }) =>
        Effect.gen(function* () {
          // A missing cookie arrives as an empty credential.
          const value = Redacted.value(credential);
          if (value === "") return yield* new Unauthorized();
          const session = yield* sessions
            .find(hashSecret(value))
            // An unreachable database must not look like "logged out".
            .pipe(Effect.orDie);
          if (Option.isNone(session)) return yield* new Unauthorized();
          return yield* Effect.provideService(
            httpEffect,
            CurrentUser,
            toSessionInfo(session.value),
          );
        }),
    });
  }),
);
