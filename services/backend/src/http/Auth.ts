import {
  Api,
  CurrentUser,
  LoginErrorParam,
  LoginErrorReason,
  type LoginQuery,
  RateLimited,
  SessionCookie,
} from "@unhalteproblem.de/api";
import {
  type AuthorizationCallback,
  CodeVerifier,
  OAuthBadRequest,
  type PromptValue,
} from "@unhalteproblem.de/oidc";
import { DateTime, Effect, Option, Redacted, Schema } from "effect";
import { type HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { SqlClient } from "effect/sql";
import { cookieOptions, LoginCookie, LoginTimeout } from "#auth/Cookies";
import {
  hashSecret,
  pkceChallenge,
  randomSecret,
  secretsEqual,
} from "#auth/Secrets";
import { PublicUrlConfig, SessionConfig } from "#Config";
import { UserCommands } from "#domains/users/UserCommands";
import { UserQueries } from "#domains/users/UserQueries";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { LoginAttempts } from "#repositories/LoginAttempts";
import { LogoutTokens } from "#repositories/LogoutTokens";
import { Sessions } from "#repositories/Sessions";
import { LoginRateLimit } from "#services/LoginRateLimit";
import { OidcProvider } from "#services/OidcProvider";
import { clockToleranceSeconds, TokenVerifier } from "#services/TokenVerifier";
import { noStore } from "./CacheControl.ts";
import { clientKey } from "./ClientIp.ts";
import { requireSameOrigin } from "./SameOrigin.ts";

/**
 * Why a callback did not end in a session. `detail` goes to the log only;
 * the browser just gets the coarse `reason`.
 */
class LoginFailed extends Schema.TaggedError<
  LoginFailed,
  { readonly brand: unique symbol }
>()("LoginFailed", {
  reason: LoginErrorReason,
  detail: Schema.String,
}) {}

const fail = (reason: LoginErrorReason, detail: string) =>
  Effect.fail(new LoginFailed({ reason, detail }));

/** The fields of `record` that are not `undefined`. */
const definedOnly = <A extends object>(
  record: A,
): { [K in keyof A]?: Exclude<A[K], undefined> } =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as { [K in keyof A]?: Exclude<A[K], undefined> };

export const AuthHandlers = HttpApiBuilder.group(
  Api,
  "auth",
  Effect.fn(function* (handlers) {
    const oidc = yield* OidcProvider;
    const verifier = yield* TokenVerifier;
    const loginAttempts = yield* LoginAttempts;
    const sessions = yield* Sessions;
    const logoutTokens = yield* LogoutTokens;
    const loginRateLimit = yield* LoginRateLimit;
    const userCommands = yield* UserCommands;
    const userQueries = yield* UserQueries;
    const moderation = yield* ModerationQueries;
    const audit = yield* AuditCommands;
    const sql = yield* SqlClient.SqlClient;
    const { origin } = yield* PublicUrlConfig;
    const { maxAge } = yield* SessionConfig;

    /**
     * For audit entries of things that already happened or are refused
     * anyway (a logout, a refused login): the user gets the redirect even if
     * the entry can't be written, which is logged instead.
     */
    const bestEffort = (entry: Effect.Effect<void>) =>
      entry.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Audit entry not written", cause),
        ),
      );

    /** Our id of the user with this OIDC `sub`, if they have ever logged in. */
    const userIdOf = (subject: string) =>
      userQueries
        .findBySubject(subject)
        .pipe(Effect.map(Option.map((user) => user.id)));

    /**
     * Starts the authorization code flow: stores the login attempt, sets the
     * login cookie and redirects to the provider, which shows the login form
     * or, with `prompt: "create"`, the registration form.
     */
    const startLogin = Effect.fn("auth.startLogin")(function* (
      query: LoginQuery,
      request: HttpServerRequest.HttpServerRequest,
      prompt?: PromptValue,
    ) {
      yield* loginRateLimit
        .consume(clientKey(request))
        .pipe(
          Effect.catchTag("LoginRateLimitExceeded", () =>
            Effect.fail(new RateLimited()),
          ),
        );
      const { loginCookie, state, nonce, codeVerifier } = yield* Effect.all({
        loginCookie: randomSecret,
        state: randomSecret,
        nonce: randomSecret,
        codeVerifier: randomSecret,
      });
      const now = yield* DateTime.now;
      yield* loginAttempts
        .create({
          idHash: hashSecret(loginCookie),
          state,
          nonce,
          codeVerifier,
          returnTo: query.returnTo ?? "/",
          expiresAt: DateTime.addDuration(now, LoginTimeout),
        })
        .pipe(Effect.orDie);
      const url = yield* oidc.authorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
        ...(prompt === undefined ? {} : { prompt }),
      });
      return HttpServerResponse.redirect(url, { status: 302 }).pipe(
        HttpServerResponse.setCookieUnsafe(LoginCookie, loginCookie, {
          ...cookieOptions,
          maxAge: LoginTimeout,
        }),
      );
    });

    /**
     * Steps 1 to 4 of the callback: match it to the login attempt of this
     * browser, redeem the code and verify the ID token (OIDC Core §3.1.3,
     * RFC 9207). Returns the new session's cookie value and where to go.
     */
    const completeLogin = Effect.fn("auth.completeLogin")(function* (
      query: AuthorizationCallback,
      loginCookie: string | undefined,
    ) {
      if (loginCookie === undefined || loginCookie === "") {
        return yield* fail("expired", "no login cookie");
      }
      // Single use: the attempt is gone after this, whatever happens next.
      const attempt = yield* loginAttempts
        .take(hashSecret(loginCookie))
        .pipe(Effect.orDie);
      if (Option.isNone(attempt)) {
        return yield* fail("expired", "unknown or expired login attempt");
      }
      const { state, nonce, codeVerifier, returnTo } = attempt.value;

      if (!secretsEqual(query.state ?? "", state)) {
        return yield* fail("failed", "state mismatch");
      }
      // RFC 9207: Keycloak advertises the `iss` parameter, so it must be
      // present and name our issuer (mix-up attack defence).
      if (query.iss !== oidc.issuer) {
        return yield* fail("failed", `unexpected iss ${String(query.iss)}`);
      }
      if ("error" in query) {
        return yield* fail(
          query.error === "access_denied" ? "cancelled" : "failed",
          `provider error ${query.error}`,
        );
      }

      const tokens = yield* oidc
        .exchangeCode({
          code: query.code,
          // Generated by `randomSecret` at login, so it always decodes.
          codeVerifier: yield* Schema.decodeEffect(CodeVerifier)(
            Redacted.value(codeVerifier),
          ).pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchTag("CodeExchangeFailed", (e) =>
            fail("failed", e.reason),
          ),
        );
      if (tokens.id_token === undefined) {
        return yield* fail("failed", "token response without id_token");
      }
      const claims = yield* verifier
        .verifyIdToken(tokens.id_token, { nonce })
        .pipe(
          Effect.catchTags({
            InvalidToken: (e) =>
              fail("failed", `invalid ID token: ${e.reason}`),
            KeysUnavailable: (e) =>
              Effect.logError("Provider keys unavailable").pipe(
                Effect.annotateLogs({ detail: e.reason }),
                Effect.andThen(fail("failed", "provider keys unavailable")),
              ),
          }),
        );
      // Back-channel logout finds sessions by Keycloak's session id, so a
      // session without one could never be ended from Keycloak.
      if (claims.sid === undefined) {
        return yield* fail("failed", "ID token without sid");
      }

      // Keycloak still lets a restricted user log in; we don't. Checked
      // before the sync, so a refused attempt isn't recorded as a login (a
      // restricted user has always logged in before).
      if ((yield* moderation.accessOf(claims.sub)).restricted) {
        yield* bestEffort(
          Effect.gen(function* () {
            yield* audit.record({
              action: "login_refused",
              actor: Option.none(),
              target: yield* userIdOf(claims.sub),
              detail: "restricted",
            });
          }),
        );
        return yield* fail("restricted", "account is restricted");
      }

      // Our copy of the user, created on the first login. Fails the login
      // (as a defect) if the database is unreachable, like the session.
      const user = yield* userCommands.syncFromLogin({
        subject: claims.sub,
        profile: {
          username: Option.fromUndefinedOr(claims.preferred_username),
          name: Option.fromUndefinedOr(claims.name),
          email: Option.fromUndefinedOr(claims.email),
          emailVerified: claims.email_verified ?? false,
        },
      });

      // Before the session exists and not best-effort: a login whose entry
      // can't be written fails, so every session has its entry and a failure
      // leaves nothing behind.
      yield* audit.record({
        action: "login",
        actor: Option.some(user.id),
        target: Option.some(user.id),
      });

      const sessionCookie = yield* randomSecret;
      const now = yield* DateTime.now;
      yield* sessions
        .create({
          idHash: hashSecret(sessionCookie),
          userId: claims.sub,
          providerSessionId: Option.some(claims.sid),
          claims: definedOnly({
            preferred_username: claims.preferred_username,
            name: claims.name,
            email: claims.email,
            email_verified: claims.email_verified,
          }),
          expiresAt: DateTime.addDuration(now, maxAge),
        })
        .pipe(Effect.orDie);
      // A restriction or a deletion that committed between the check above and
      // this insert has already ended the sessions it knew of, but not this
      // one, whose row would sit there with the profile claims until it
      // expires. Look again now that it exists: whichever side commits last
      // sees the other, so the session survives only for a user in good standing.
      if ((yield* moderation.accessOf(claims.sub)).restricted) {
        yield* sessions.delete(hashSecret(sessionCookie)).pipe(Effect.orDie);
        return yield* fail("restricted", "account blocked during the login");
      }
      yield* Effect.logInfo("Login succeeded").pipe(
        Effect.annotateLogs({ userId: claims.sub }),
      );
      return { sessionCookie, returnTo };
    });

    /**
     * The end of a successful callback: replaces the browser's session with
     * the new one and sends it where the login started.
     */
    const finishLogin = Effect.fn("auth.finishLogin")(function* (
      request: HttpServerRequest.HttpServerRequest,
      { sessionCookie, returnTo }: { sessionCookie: string; returnTo: string },
    ) {
      // A new session id on every login (no session fixation); the
      // browser's previous session, if any, ends here.
      const previous = request.cookies[SessionCookie];
      if (previous !== undefined && previous !== "") {
        yield* sessions.delete(hashSecret(previous)).pipe(Effect.orDie);
      }
      return HttpServerResponse.redirect(`${origin}${returnTo}`, {
        status: 302,
      }).pipe(
        HttpServerResponse.setCookieUnsafe(SessionCookie, sessionCookie, {
          ...cookieOptions,
          maxAge,
        }),
      );
    });

    // Every auth response carries personal data, cookies or one-time URLs:
    // each handler is `noStore`, its error responses included. (Responses made
    // before a handler runs, like a 400 for a malformed request, are not.)
    return (
      handlers
        .handle("session", () => Effect.service(CurrentUser).pipe(noStore))

        .handle("login", ({ query, request }) =>
          startLogin(query, request).pipe(noStore),
        )

        // The same flow; Keycloak shows its registration form first and then
        // returns to the callback like after a login.
        .handle("register", ({ query, request }) =>
          startLogin(query, request, "create").pipe(noStore),
        )

        .handle("callback", ({ query, request }) =>
          completeLogin(query, request.cookies[LoginCookie]).pipe(
            Effect.flatMap((login) => finishLogin(request, login)),
            Effect.catchTag("LoginFailed", ({ reason, detail }) =>
              Effect.logWarning("Login failed").pipe(
                Effect.annotateLogs({ reason, detail }),
                Effect.as(
                  HttpServerResponse.redirect(
                    `${origin}/?${LoginErrorParam}=${reason}`,
                    { status: 302 },
                  ),
                ),
              ),
            ),
            // The user is in the middle of a page navigation: an unexpected
            // failure (e.g. the database) also ends on the website, not on a
            // bare error page. The attempt is consumed either way.
            Effect.catchDefect((defect) =>
              Effect.logError("Login callback failed", defect).pipe(
                Effect.as(
                  HttpServerResponse.redirect(
                    `${origin}/?${LoginErrorParam}=failed`,
                    { status: 302 },
                  ),
                ),
              ),
            ),
            Effect.map(
              HttpServerResponse.expireCookieUnsafe(LoginCookie, cookieOptions),
            ),
            noStore,
          ),
        )

        .handle("logout", ({ request }) =>
          Effect.gen(function* () {
            // CSRF: only the website itself may log the user out. A plain
            // form POST, so the check is here rather than in the contract.
            yield* requireSameOrigin(origin);
            const cookie = request.cookies[SessionCookie];
            if (cookie !== undefined && cookie !== "") {
              const ended = yield* sessions
                .delete(hashSecret(cookie))
                .pipe(Effect.orDie);
              if (Option.isSome(ended)) {
                const subject = ended.value.userId;
                yield* bestEffort(
                  Effect.gen(function* () {
                    const user = yield* userIdOf(subject);
                    yield* audit.record({
                      action: "logout",
                      actor: user,
                      target: user,
                    });
                  }),
                );
              }
            }
            // No `id_token_hint` (we keep no ID token), so Keycloak asks the
            // user to confirm before it ends its own session.
            const url = yield* oidc.endSessionUrl;
            return HttpServerResponse.redirect(url, { status: 303 }).pipe(
              HttpServerResponse.expireCookieUnsafe(
                SessionCookie,
                cookieOptions,
              ),
            );
          }).pipe(noStore),
        )

        // `noStore` is Back-Channel Logout 1.0 §2.8, for success and error
        // responses.
        .handle("backchannelLogout", ({ payload }) =>
          Effect.gen(function* () {
            const claims = yield* verifier
              .verifyLogoutToken(payload.logout_token)
              .pipe(
                Effect.catchTag("InvalidToken", (e) =>
                  Effect.logWarning("Rejected back-channel logout").pipe(
                    Effect.annotateLogs({ detail: e.reason }),
                    Effect.andThen(
                      Effect.fail(
                        new OAuthBadRequest({
                          error: "invalid_request",
                          error_description: "Invalid logout token",
                        }),
                      ),
                    ),
                  ),
                ),
              );
            // A replayed token is acknowledged but changes nothing: its
            // sessions are already gone, and a `sub`-only token must not end
            // sessions started after the original logout. The jti is kept as
            // long as the verifier would still accept the token. Remembering
            // and deleting are one transaction, so a failed delete does not
            // leave the token marked as used (Keycloak can redeliver it).
            const ended = yield* sql.withTransaction(
              Effect.gen(function* () {
                const fresh = yield* logoutTokens.remember(
                  claims.jti,
                  DateTime.makeUnsafe(
                    (claims.exp + clockToleranceSeconds) * 1000,
                  ),
                );
                if (!fresh) return Option.none<number>();
                return Option.some(
                  claims.sid !== undefined
                    ? yield* sessions.deleteByProviderSession(claims.sid)
                    : claims.sub !== undefined
                      ? yield* sessions.deleteByUser(claims.sub)
                      : 0,
                );
              }),
            );
            if (Option.isNone(ended)) {
              return yield* Effect.logWarning("Replayed logout token ignored");
            }
            yield* Effect.logInfo("Back-channel logout").pipe(
              Effect.annotateLogs({ sessionsEnded: ended.value }),
            );
          }).pipe(
            // Operational failures are 500s and errors in the log; only a
            // rejected token is the provider's problem (400).
            Effect.catchTags({
              SqlError: Effect.die,
              KeysUnavailable: Effect.die,
            }),
            noStore,
          ),
        )
    );
  }),
);
