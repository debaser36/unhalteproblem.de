import { Authentication } from "#Authentication";
import { LoginQuery, SessionInfo } from "#domain/Auth";
import { Forbidden } from "#errors/Forbidden";
import { RateLimited } from "#errors/RateLimited";
import {
  AuthorizationCallback,
  BackchannelLogoutRequest,
  OAuthBadRequest,
} from "@unhalteproblem.de/oidc";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Documents a redirect response. Handlers return the redirect as an
 * `HttpServerResponse` (e.g. `HttpServerResponse.redirect`), so this schema
 * only describes the status and the `Location` header for OpenAPI and the
 * generated client.
 */
const Redirect = (status: 302 | 303, description: string) =>
  HttpApiSchema.WithHeaders(
    HttpApiSchema.Empty(status).annotate({ description }),
    {
      location: Schema.String,
    },
  );

/**
 * Browser login with OpenID Connect (Keycloak) in the backend-for-frontend
 * pattern: the backend runs the authorization code flow with PKCE and keeps
 * the tokens; the browser only holds the `__Host-session` cookie.
 *
 * `login`, `callback` and `logout` are top-level browser navigations, not
 * `fetch` calls: the website links to `GET /auth/login` and submits a form
 * to `POST /auth/logout`, because both end in a redirect to Keycloak. Build
 * their URLs with `HttpApiClient.urlBuilder` instead of calling them through
 * `HttpApiClient`. Only `session` is meant for the website's client.
 */
export class AuthGroup extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("session", "/auth/session", {
      success: SessionInfo,
      // `Unauthorized` (401) comes from the `Authentication` middleware.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Current session",
        description:
          "Returns the logged-in user and when the session expires. " +
          "Answers 401 `Unauthorized` without a valid session cookie, which " +
          "is how the website finds out that nobody is logged in.",
      }),
    ),
  )
  // Protects every endpoint added above. The endpoints below are added after
  // it and are public on purpose; each one says why.
  .middleware(Authentication)
  .add(
    // Public on purpose: it starts the login, so there is no session yet.
    HttpApiEndpoint.get("login", "/auth/login", {
      query: LoginQuery,
      success: Redirect(
        302,
        "Redirect to Keycloak's authorization endpoint. Sets a short-lived " +
          "login cookie binding `state`, `nonce` and the PKCE verifier to " +
          "this browser.",
      ),
      // An invalid `returnTo` is rejected by schema validation (400).
      // `RateLimited` (429): every login start writes a row for the
      // pending login, so the backend limits them per client and globally.
      error: RateLimited,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Start the login",
        description:
          "Starts the OpenID Connect authorization code flow with PKCE and " +
          "redirects the browser to Keycloak. After the login the browser " +
          "returns to `returnTo` (a path on this site) or the start page. " +
          "Answers 429 `RateLimited` when too many logins are started, " +
          "per client or in total. " +
          "Navigate to it; do not call it with `fetch`.",
      }),
    ),
    // Public on purpose: it is the OAuth redirect URI that Keycloak sends
    // the browser back to, and it completes the login. It is protected by
    // the login cookie (`state`, `nonce`, PKCE), not by a session.
    HttpApiEndpoint.get("callback", "/auth/callback", {
      query: AuthorizationCallback,
      success: Redirect(
        302,
        "Redirect back to the website: to the `returnTo` path of the login " +
          "with the session cookie set, or to `/?login_error=<reason>` " +
          "(`cancelled`, `expired` or `failed`, see `LoginErrorReason`) if " +
          "the login failed.",
      ),
      // Malformed queries are rejected by schema validation (400). Every
      // other failure (user cancelled, expired login cookie, bad token)
      // still redirects to the website, with `login_error` set.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Login callback",
        description:
          "The redirect URI registered at Keycloak. Validates `state`, " +
          "exchanges the authorization code for tokens, creates the session " +
          "and redirects the browser back to the website.",
      }),
    ),
    // Public on purpose (no `Authentication`): logging out must also work
    // with an expired or unknown session, in which case it only clears the
    // cookies. CSRF protection comes from the `Origin` check instead.
    HttpApiEndpoint.post("logout", "/auth/logout", {
      success: Redirect(
        303,
        "Redirect to Keycloak's end-session endpoint, which ends the " +
          "Keycloak session and returns the browser to the website.",
      ),
      error: Forbidden,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Log out",
        description:
          "Ends the session, clears the session cookie and redirects the " +
          "browser to Keycloak to end the single sign-on session too. " +
          "Without a session it only clears the cookies. Requests without " +
          "an `Origin` header or with an `Origin` other than the website's " +
          "own are rejected with 403 `Forbidden` (CSRF protection; browsers " +
          "always send `Origin` on POST). Submit it as a form; do not call " +
          "it with `fetch`.",
      }),
    ),
    // Public on purpose (no `Authentication`): Keycloak calls it
    // server-to-server, without a browser or cookie. The request is
    // authenticated by the signed logout token in the body, which the
    // handler verifies before ending any session.
    HttpApiEndpoint.post("backchannelLogout", "/auth/backchannel-logout", {
      payload: BackchannelLogoutRequest,
      success: HttpApiSchema.Empty(200).annotate({
        description: "The matching sessions have been ended.",
      }),
      error: OAuthBadRequest,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Back-channel logout",
        description:
          "Called by Keycloak when a session ends there (OpenID Connect " +
          "Back-Channel Logout 1.0). Verifies the logout token and ends the " +
          "local sessions of its `sub` and/or `sid`. Answers 200, or 400 " +
          "with an OAuth error body (`invalid_request`) for an invalid " +
          "token (§2.8); both with `Cache-Control: no-store`.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Auth",
      description:
        "Browser login with OpenID Connect (Keycloak). The backend runs the " +
        "login and keeps the tokens; the browser holds only an HttpOnly " +
        "session cookie.",
    }),
  ) {}
