import type { SessionInfo } from "#domain/Auth";
import { Unauthorized } from "#errors/Unauthorized";
import { Context } from "effect";
import { HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api";

// Definitions only. The middleware implementation (looking up the session
// behind the cookie) lives in the backend; the browser needs none, because it
// sends the cookie by itself.

/**
 * Name of the session cookie the backend sets after a successful login.
 *
 * The `__Host-` prefix makes the browser accept it only with `Secure`,
 * `Path=/` and no `Domain`, so it is bound to exactly this host and cannot be
 * planted by a subdomain.
 */
export const SessionCookie = "__Host-session";

/**
 * The `session` security scheme: an opaque session id in the
 * `__Host-session` cookie. The backend sets it with
 * `HttpApiBuilder.securitySetCookie(SessionSecurity, ...)`.
 */
export const SessionSecurity = HttpApiSecurity.apiKey({
  in: "cookie",
  key: SessionCookie,
}).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Session cookie set by `GET /auth/callback` after a successful login.",
  ),
);

/** The logged-in session, provided by `Authentication` to protected handlers. */
export class CurrentUser extends Context.Service<CurrentUser, SessionInfo>()(
  "@unhalteproblem.de/api/CurrentUser",
) {}

/**
 * Requires a logged-in session: resolves the session cookie, provides
 * `CurrentUser`, and fails with `Unauthorized` (401) if there is no valid
 * session.
 *
 * `requiredForClient` stays `false`: browsers attach the cookie themselves,
 * so the website's client needs no middleware of its own.
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("@unhalteproblem.de/api/Authentication", {
  error: Unauthorized,
  security: { session: SessionSecurity },
}) {}
