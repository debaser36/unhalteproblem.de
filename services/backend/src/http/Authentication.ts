import {
  Authentication,
  CurrentUser,
  type Role,
  type SessionInfo,
  Unauthorized,
} from "@unhalteproblem.de/api";
import { Effect, Layer, Option, Redacted } from "effect";
import { hashSecret } from "#auth/Secrets";
import { type AuthenticatedSession, SessionAccess } from "#auth/SessionAccess";

/**
 * What the website learns about a session (`GET /auth/session`): the
 * profile from the login, and the roles as they are now.
 */
export const toSessionInfo = (
  session: Pick<AuthenticatedSession, "userId" | "claims" | "expiresAt">,
  roles: ReadonlyArray<Role>,
): SessionInfo => {
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
      roles,
    },
    expiresAt: session.expiresAt,
  };
};

/**
 * Resolves the `__Host-session` cookie to an unexpired session and provides
 * it as `CurrentUser`; anything else is `Unauthorized`.
 *
 * The roles and the restriction are read on every request, not stored in
 * the session, so a granted or revoked role counts from the user's next
 * request on, and a restricted user is refused at once.
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const sessionAccess = yield* SessionAccess;
    return Authentication.of({
      session: (httpEffect, { credential }) =>
        Effect.gen(function* () {
          // A missing cookie arrives as an empty credential.
          const value = Redacted.value(credential);
          if (value === "") return yield* new Unauthorized();
          const session = yield* sessionAccess
            .find(hashSecret(value))
            // An unreachable database must not look like "logged out".
            .pipe(Effect.orDie);
          if (Option.isNone(session)) return yield* new Unauthorized();
          // Restricting ends the sessions; this also covers one that
          // was created concurrently or survived for any other reason.
          if (session.value.restricted) return yield* new Unauthorized();
          return yield* Effect.provideService(
            httpEffect,
            CurrentUser,
            toSessionInfo(session.value, session.value.roles),
          );
        }),
    });
  }),
).pipe(Layer.provide(SessionAccess.layer));
