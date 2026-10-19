import type { Role, User } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { ApiClient } from "./ApiClient.ts";

/** Reactivity key of everything that depends on who is logged in. */
export const sessionKey = "session";

/**
 * The current login session: `Success` with the session, `Success` with
 * `null` when nobody is logged in (the backend answers 401), `Failure` only
 * when the backend is unreachable.
 */
export const sessionAtom = ApiClient.runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.auth
        .session()
        .pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null)));
    }),
  )
  .pipe(Atom.withReactivity([sessionKey]), Atom.keepAlive);

/** The logged-in user, or `null` (also while loading). */
export const userAtom = Atom.make((get) => {
  const result = get(sessionAtom);
  return AsyncResult.isSuccess(result) ? (result.value?.user ?? null) : null;
});

export const hasRole = (user: User | null, role: Role): boolean =>
  user?.roles.includes(role) ?? false;

/** Where the login and registration flows start; full-page navigations. */
export const loginUrl = (
  returnTo: string,
  flow: "login" | "register" = "login",
) => `/api/auth/${flow}?${new URLSearchParams({ returnTo })}`;

/** The path and query of the current page, as a `returnTo` for the login. */
export const currentPath = () =>
  // Browsers keep these percent-encoded, as `ReturnPath` requires.
  window.location.pathname + window.location.search + window.location.hash;
