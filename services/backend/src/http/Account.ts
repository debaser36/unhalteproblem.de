import { Api, CurrentUser } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { cookieOptions } from "#auth/Cookies";
import { SessionCookie } from "@unhalteproblem.de/api";
import { UserCommands } from "#domains/users/UserCommands";

/** The own account: what the logged-in user can do about themselves. */
export const AccountHandlers = HttpApiBuilder.group(
  Api,
  "account",
  Effect.fn(function* (handlers) {
    const users = yield* UserCommands;
    return handlers.handle("deleteAccount", () =>
      Effect.gen(function* () {
        // The session's user: `Authentication` made it from the cookie, so
        // this can only ever be the caller's own account.
        const { user } = yield* Effect.service(CurrentUser);
        yield* users.deleteAccount(user.id);
        // Only after it worked: a refused deletion keeps the session. The
        // session is gone either way by now; this removes the cookie too.
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            response.pipe(
              HttpServerResponse.setHeader("cache-control", "no-store"),
              HttpServerResponse.expireCookieUnsafe(
                SessionCookie,
                cookieOptions,
              ),
            ),
          ),
        );
      }),
    );
  }),
);
