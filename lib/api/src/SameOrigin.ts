import { Forbidden } from "#errors/Forbidden";
import { HttpApiMiddleware } from "effect/http-api";

// Definitions only. The middleware implementation lives in the backend; the
// browser needs none, because it sends `Origin` by itself.

/**
 * CSRF protection for state-changing endpoints that are authenticated by
 * the session cookie, in depth on top of its `SameSite=Lax`.
 *
 * `SameSite=Lax` keeps the cookie off cross-site requests, but "site" means
 * the registrable domain: pages on same-site subdomains (such as
 * `auth.unhalteproblem.de`) still get it attached. The backend
 * implementation therefore rejects every request whose `Origin` header is
 * missing or isn't exactly the website's own origin with 403 `Forbidden`.
 * Browsers always send `Origin` on non-GET `fetch` requests and form
 * submissions, so the website's own requests pass and a legitimate client
 * never sees this error.
 *
 * Put it on each state-changing endpoint (POST, PUT, PATCH, DELETE), next
 * to its role middleware; never on GET endpoints, which must not change
 * state. It needs nothing from other middlewares and provides nothing, and
 * it declares no security scheme because it checks no credential.
 */
export class SameOrigin extends HttpApiMiddleware.Service<SameOrigin>()(
  "@unhalteproblem.de/api/SameOrigin",
  { error: Forbidden },
) {}
