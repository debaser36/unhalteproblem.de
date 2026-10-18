import { assert, describe, it } from "@effect/vitest";
import { Api } from "@unhalteproblem.de/api";
import {
  AccessToken,
  BackchannelLogoutEvent,
  IdToken,
  type TokenResponse,
} from "@unhalteproblem.de/oidc";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { pkceChallenge } from "#auth/Secrets";
import { DomainsLive } from "#domains/Domains";
import { UserQueries } from "#domains/users/UserQueries";
import { LoginAttempts } from "#repositories/LoginAttempts";
import { LogoutTokens } from "#repositories/LogoutTokens";
import { LoginRateLimit } from "#services/LoginRateLimit";
import { Sessions } from "#repositories/Sessions";
import { ContactDelivery } from "#services/ContactDelivery";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { CodeExchangeFailed, OidcProvider } from "#services/OidcProvider";
import { TokenVerifier } from "#services/TokenVerifier";
import { DatabaseTest } from "#testing/Database";
import { AuthHandlers } from "./Auth.ts";
import { AuthenticationLive } from "./Authentication.ts";
import { ContactHandlers } from "./Contact.ts";
import { SystemHandlers } from "./System.ts";

// The defaults of PUBLIC_ORIGIN and the API URL, which the handlers use.
const site = "https://unhalteproblem.de";
const api = "http://backend.test";

const issuer = "https://auth.example.org/realms/test";
const clientId = "backend";

const key = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256" };

const now = () => Math.floor(Date.now() / 1000);
const sign = (payload: JWTPayload) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(key.privateKey);

interface AppOptions {
  /** Changes the nonce the provider puts into the ID token. */
  readonly nonce?: (nonce: string) => string;
  /** The ID token's `sid`; `null` leaves it out. */
  readonly sid?: string | null;
  /** Login starts allowed per client. */
  readonly loginLimit?: number;
}

/**
 * Stands in for Keycloak: records the authentication requests and, on code
 * exchange, checks PKCE and issues an ID token for the login's nonce.
 */
const makeProvider = (options: AppOptions) => {
  const logins = new Map<string, { nonce: string; codeChallenge: string }>();
  const provider = OidcProvider.of({
    issuer,
    redirectUri: `${api}/auth/callback`,
    authorizationUrl: ({ state, nonce, codeChallenge, prompt }) =>
      Effect.sync(() => {
        logins.set(state, { nonce, codeChallenge });
        const query = new URLSearchParams({ state });
        if (prompt !== undefined) query.set("prompt", prompt);
        return `${issuer}/auth?${query}`;
      }),
    exchangeCode: ({ code, codeVerifier }) =>
      Effect.gen(function* () {
        // The test uses the login's state as the code.
        const login = logins.get(Redacted.value(code));
        if (
          login === undefined ||
          pkceChallenge(Redacted.value(codeVerifier)) !== login.codeChallenge
        ) {
          return yield* new CodeExchangeFailed({ reason: "invalid_grant" });
        }
        const idToken = yield* Effect.promise(() =>
          sign({
            iss: issuer,
            sub: "user-1",
            aud: clientId,
            iat: now(),
            exp: now() + 300,
            nonce: options.nonce?.(login.nonce) ?? login.nonce,
            ...(options.sid === null
              ? {}
              : { sid: options.sid ?? "kc-session-1" }),
            preferred_username: "ada",
            email: "ada@example.org",
            email_verified: true,
          }),
        );
        const response: TokenResponse = {
          access_token: yield* Schema.decodeEffect(AccessToken)("at").pipe(
            Effect.orDie,
          ),
          token_type: "Bearer",
          id_token: yield* Schema.decodeEffect(IdToken)(idToken).pipe(
            Effect.orDie,
          ),
        };
        return response;
      }),
    endSessionUrl: (idToken) =>
      Effect.succeed(
        `${issuer}/logout?hint=${idToken === undefined ? "none" : "id_token"}`,
      ),
  });
  return provider;
};

/**
 * The backend's HTTP app with a fresh in-memory database, and the services
 * behind it (database, repositories, domains) for checking stored state.
 */
const makeAppWithServices = Effect.fnUntraced(function* (
  options: AppOptions = {},
) {
  const services = yield* Layer.build(
    Layer.mergeAll(
      LoginAttempts.layer,
      Sessions.layer,
      LogoutTokens.layer,
      DomainsLive,
    ).pipe(Layer.provideMerge(DatabaseTest)),
  );
  const repositories = Layer.succeedContext(services);
  const handlers = Layer.mergeAll(
    AuthHandlers,
    SystemHandlers,
    ContactHandlers,
  ).pipe(
    Layer.provide([
      Layer.succeed(OidcProvider, makeProvider(options)),
      TokenVerifier.layerWith({
        issuer,
        clientId,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      LoginRateLimit.layerWith({
        limit: options.loginLimit ?? 100,
        globalLimit: 1000,
        window: "1 hour",
      }),
      ContactDelivery.layerLog,
      ContactRateLimit.layerWith({
        limit: 5,
        globalLimit: 5,
        window: "1 hour",
      }),
    ]),
    Layer.provideMerge(AuthenticationLive),
    Layer.provideMerge(repositories),
  );
  const app = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(handlers),
    Layer.provide(HttpServer.layerServices),
  );
  const { handler } = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
    ({ dispose }) => Effect.promise(dispose),
  );
  const request = (path: string, init?: RequestInit) =>
    Effect.promise(() => handler(new Request(`${api}${path}`, init)));
  return { request, services };
});

/** The backend's HTTP app with a fresh in-memory database. */
const makeApp = (options: AppOptions = {}) =>
  Effect.map(makeAppWithServices(options), ({ request }) => request);

/** `name=value` of a `Set-Cookie` header, or undefined. */
const setCookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));

const cookieValue = (response: Response, name: string) =>
  setCookie(response, name)
    ?.split(";")[0]
    ?.slice(name.length + 1);

/**
 * Runs `/auth/login` (or `/auth/register`) and returns the login cookie and
 * the state.
 */
const startLogin = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
  returnTo = "/blog/post?x=1",
  endpoint: "login" | "register" = "login",
) =>
  Effect.gen(function* () {
    const response = yield* request(
      `/auth/${endpoint}?returnTo=${encodeURIComponent(returnTo)}`,
    );
    assert.strictEqual(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    const state = location.searchParams.get("state") ?? "";
    const loginCookie = cookieValue(response, "__Host-login") ?? "";
    return { response, state, loginCookie };
  });

const callback = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
  query: Record<string, string>,
  loginCookie: string | undefined,
) =>
  request(`/auth/callback?${new URLSearchParams(query)}`, {
    headers:
      loginCookie === undefined
        ? {}
        : { cookie: `__Host-login=${loginCookie}` },
  });

/** A complete login; returns the session cookie value. */
const login = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
) =>
  Effect.gen(function* () {
    const { state, loginCookie } = yield* startLogin(request);
    const response = yield* callback(
      request,
      { code: state, state, iss: issuer },
      loginCookie,
    );
    assert.strictEqual(response.status, 302);
    return cookieValue(response, "__Host-session") ?? "";
  });

const session = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
  sessionCookie: string,
) =>
  request("/auth/session", {
    headers: { cookie: `__Host-session=${sessionCookie}` },
  });

describe("auth login flow", () => {
  it.effect("login redirects to the provider and sets the login cookie", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { response, state, loginCookie } = yield* startLogin(request);
      assert.match(
        response.headers.get("location") ?? "",
        /^https:\/\/auth\.example\.org\//,
      );
      assert.isAbove(state.length, 40);
      assert.isAbove(loginCookie.length, 40);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      const cookie = setCookie(response, "__Host-login") ?? "";
      for (const attribute of [
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=600",
      ]) {
        assert.include(cookie, attribute);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("rejects an open redirect as returnTo", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const response = yield* request(
        `/auth/login?returnTo=${encodeURIComponent("//evil.example")}`,
      );
      assert.strictEqual(response.status, 400);
    }).pipe(Effect.scoped),
  );

  it.effect("callback creates a session and returns to the page", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { state, loginCookie } = yield* startLogin(request);
      const response = yield* callback(
        request,
        { code: state, state, iss: issuer, session_state: "x" },
        loginCookie,
      );
      assert.strictEqual(response.status, 302);
      assert.strictEqual(
        response.headers.get("location"),
        `${site}/blog/post?x=1`,
      );
      const sessionCookie = setCookie(response, "__Host-session") ?? "";
      assert.include(sessionCookie, "HttpOnly");
      assert.include(sessionCookie, "Secure");
      assert.include(sessionCookie, "SameSite=Lax");
      // The login cookie is cleared.
      assert.include(setCookie(response, "__Host-login") ?? "", "Max-Age=0");

      const info = yield* session(
        request,
        cookieValue(response, "__Host-session") ?? "",
      );
      assert.strictEqual(info.status, 200);
      const body = yield* Effect.promise(() => info.json());
      assert.deepInclude(body, {
        user: {
          id: "user-1",
          username: "ada",
          email: "ada@example.org",
          emailVerified: true,
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("callback creates the user and updates it on later logins", () =>
    Effect.gen(function* () {
      const { request, services } = yield* makeAppWithServices();
      const findUser = Effect.gen(function* () {
        const queries = yield* UserQueries;
        return yield* queries.findBySubject("user-1");
      }).pipe(Effect.provide(services));
      assert.isTrue(Option.isNone(yield* findUser));

      const logIn = Effect.gen(function* () {
        const { state, loginCookie } = yield* startLogin(request);
        const response = yield* callback(
          request,
          { code: state, state, iss: issuer },
          loginCookie,
        );
        assert.strictEqual(response.status, 302);
      });

      yield* logIn;
      const user = Option.getOrThrow(yield* findUser);
      assert.deepStrictEqual(user.username, Option.some("ada"));
      assert.deepStrictEqual(user.email, Option.some("ada@example.org"));
      assert.deepStrictEqual(user.name, Option.none());
      assert.isTrue(user.emailVerified);

      yield* logIn;
      const again = Option.getOrThrow(yield* findUser);
      assert.strictEqual(again.id, user.id);
    }).pipe(Effect.scoped),
  );

  it.effect("a login attempt can only be completed once", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { state, loginCookie } = yield* startLogin(request);
      const query = { code: state, state, iss: issuer };
      yield* callback(request, query, loginCookie);
      const again = yield* callback(request, query, loginCookie);
      assert.strictEqual(
        again.headers.get("location"),
        `${site}/?login_error=expired`,
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each<
    readonly [string, (s: string) => Record<string, string>, boolean, string]
  >([
    [
      "no login cookie",
      (s) => ({ code: s, state: s, iss: issuer }),
      false,
      "expired",
    ],
    [
      "another state",
      (s) => ({ code: s, state: "forged", iss: issuer }),
      true,
      "failed",
    ],
    [
      "another issuer",
      (s) => ({ code: s, state: s, iss: "https://evil.example" }),
      true,
      "failed",
    ],
    ["no issuer", (s) => ({ code: s, state: s }), true, "failed"],
    [
      "an unknown code",
      (s) => ({ code: "stolen", state: s, iss: issuer }),
      true,
      "failed",
    ],
    [
      "a cancelled login",
      (s) => ({ error: "access_denied", state: s, iss: issuer }),
      true,
      "cancelled",
    ],
    [
      "a provider error",
      (s) => ({ error: "server_error", state: s, iss: issuer }),
      true,
      "failed",
    ],
  ])("callback with %s creates no session", ([, query, withCookie, reason]) =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { state, loginCookie } = yield* startLogin(request);
      const response = yield* callback(
        request,
        query(state),
        withCookie ? loginCookie : undefined,
      );
      assert.strictEqual(response.status, 302);
      assert.strictEqual(
        response.headers.get("location"),
        `${site}/?login_error=${reason}`,
      );
      assert.isUndefined(setCookie(response, "__Host-session"));
    }).pipe(Effect.scoped),
  );

  it.effect("callback rejects an ID token for another login (nonce)", () =>
    Effect.gen(function* () {
      const request = yield* makeApp({ nonce: () => "replayed-nonce" });
      const { state, loginCookie } = yield* startLogin(request);
      const response = yield* callback(
        request,
        { code: state, state, iss: issuer },
        loginCookie,
      );
      assert.strictEqual(
        response.headers.get("location"),
        `${site}/?login_error=failed`,
      );
      assert.isUndefined(setCookie(response, "__Host-session"));
    }).pipe(Effect.scoped),
  );
});

describe("auth registration", () => {
  it.effect("register asks the provider for its registration form", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { response, loginCookie } = yield* startLogin(
        request,
        "/",
        "register",
      );
      const location = new URL(response.headers.get("location") ?? "");
      assert.strictEqual(location.searchParams.get("prompt"), "create");
      assert.isAbove(loginCookie.length, 40);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
    }).pipe(Effect.scoped),
  );

  it.effect("login does not ask for the registration form", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { response } = yield* startLogin(request);
      const location = new URL(response.headers.get("location") ?? "");
      assert.isNull(location.searchParams.get("prompt"));
    }).pipe(Effect.scoped),
  );

  it.effect("a registration ends in a session like a login", () =>
    Effect.gen(function* () {
      const { request, services } = yield* makeAppWithServices();
      const { state, loginCookie } = yield* startLogin(
        request,
        "/welcome",
        "register",
      );
      const response = yield* callback(
        request,
        { code: state, state, iss: issuer },
        loginCookie,
      );
      assert.strictEqual(response.headers.get("location"), `${site}/welcome`);
      const info = yield* session(
        request,
        cookieValue(response, "__Host-session") ?? "",
      );
      assert.strictEqual(info.status, 200);
      const user = yield* Effect.gen(function* () {
        const queries = yield* UserQueries;
        return yield* queries.findBySubject("user-1");
      }).pipe(Effect.provide(services));
      assert.isTrue(Option.isSome(user));
    }).pipe(Effect.scoped),
  );

  it.effect("rejects an open redirect as returnTo", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const response = yield* request(
        `/auth/register?returnTo=${encodeURIComponent("//evil.example")}`,
      );
      assert.strictEqual(response.status, 400);
    }).pipe(Effect.scoped),
  );

  it.effect("shares the rate limit with login", () =>
    Effect.gen(function* () {
      const request = yield* makeApp({ loginLimit: 1 });
      assert.strictEqual((yield* request("/auth/login")).status, 302);
      const limited = yield* request("/auth/register");
      assert.strictEqual(limited.status, 429);
      // Refused before anything is stored or handed out.
      assert.isUndefined(setCookie(limited, "__Host-login"));
    }).pipe(Effect.scoped),
  );
});

describe("auth login hardening", () => {
  it.effect("limits how often a client may start a login", () =>
    Effect.gen(function* () {
      const request = yield* makeApp({ loginLimit: 1 });
      assert.strictEqual((yield* request("/auth/login")).status, 302);
      assert.strictEqual((yield* request("/auth/login")).status, 429);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects an ID token without sid", () =>
    Effect.gen(function* () {
      const request = yield* makeApp({ sid: null });
      const { state, loginCookie } = yield* startLogin(request);
      const response = yield* callback(
        request,
        { code: state, state, iss: issuer },
        loginCookie,
      );
      assert.strictEqual(
        response.headers.get("location"),
        `${site}/?login_error=failed`,
      );
      assert.isUndefined(setCookie(response, "__Host-session"));
    }).pipe(Effect.scoped),
  );

  it.effect("ends the browser's previous session on a new login", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const previous = yield* login(request);
      const { state, loginCookie } = yield* startLogin(request);
      const response = yield* request(
        `/auth/callback?${new URLSearchParams({ code: state, state, iss: issuer })}`,
        {
          headers: {
            cookie: `__Host-login=${loginCookie}; __Host-session=${previous}`,
          },
        },
      );
      const next = cookieValue(response, "__Host-session") ?? "";
      assert.notStrictEqual(next, previous);
      assert.strictEqual((yield* session(request, previous)).status, 401);
      assert.strictEqual((yield* session(request, next)).status, 200);
    }).pipe(Effect.scoped),
  );

  it.effect("no auth response may be cached", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const { state, loginCookie } = yield* startLogin(request);
      const done = yield* callback(
        request,
        { code: state, state, iss: issuer },
        loginCookie,
      );
      // Fails before any database access: no login cookie.
      const failed = yield* callback(
        request,
        { code: state, state, iss: issuer },
        undefined,
      );
      const sessionCookie = cookieValue(done, "__Host-session") ?? "";
      const info = yield* session(request, sessionCookie);
      const logout = yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site, cookie: `__Host-session=${sessionCookie}` },
      });
      for (const response of [done, failed, info, logout]) {
        assert.strictEqual(response.headers.get("cache-control"), "no-store");
      }
    }).pipe(Effect.scoped),
  );
});

describe("auth session", () => {
  it.effect.each(["", "__Host-session=unknown"])(
    "answers 401 for cookie %j",
    (cookie) =>
      Effect.gen(function* () {
        const request = yield* makeApp();
        const response = yield* request("/auth/session", {
          headers: cookie === "" ? {} : { cookie },
        });
        assert.strictEqual(response.status, 401);
      }).pipe(Effect.scoped),
  );
});

describe("auth logout", () => {
  it.effect("ends the session and redirects to the provider's logout", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const sessionCookie = yield* login(request);
      const response = yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site, cookie: `__Host-session=${sessionCookie}` },
      });
      assert.strictEqual(response.status, 303);
      assert.strictEqual(
        response.headers.get("location"),
        `${issuer}/logout?hint=id_token`,
      );
      assert.include(setCookie(response, "__Host-session") ?? "", "Max-Age=0");
      assert.strictEqual((yield* session(request, sessionCookie)).status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect("works without a session", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const response = yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site },
      });
      assert.strictEqual(response.status, 303);
      assert.strictEqual(
        response.headers.get("location"),
        `${issuer}/logout?hint=none`,
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [string, Record<string, string>]>([
    ["a foreign origin", { origin: "https://evil.example" }],
    ["no origin", {}],
  ])("refuses %s and keeps the session", ([, headers]) =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const sessionCookie = yield* login(request);
      const response = yield* request("/auth/logout", {
        method: "POST",
        headers: { ...headers, cookie: `__Host-session=${sessionCookie}` },
      });
      assert.strictEqual(response.status, 403);
      assert.strictEqual((yield* session(request, sessionCookie)).status, 200);
    }).pipe(Effect.scoped),
  );
});

describe("auth back-channel logout", () => {
  const logoutToken = (claims: JWTPayload = {}) =>
    Effect.promise(() =>
      sign({
        iss: issuer,
        aud: clientId,
        iat: now(),
        exp: now() + 120,
        jti: "jti-1",
        sid: "kc-session-1",
        events: { [BackchannelLogoutEvent]: {} },
        ...claims,
      }),
    );

  const post = (
    request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
    token: string,
  ) =>
    request("/auth/backchannel-logout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: token }),
    });

  it.effect("ends the sessions of the provider session", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const sessionCookie = yield* login(request);
      const response = yield* post(request, yield* logoutToken());
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.strictEqual((yield* session(request, sessionCookie)).status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect("ends all sessions of the user for a sub-only token", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const first = yield* login(request);
      const second = yield* login(request);
      const token = yield* logoutToken({ sid: undefined, sub: "user-1" });
      assert.strictEqual((yield* post(request, token)).status, 200);
      assert.strictEqual((yield* session(request, first)).status, 401);
      assert.strictEqual((yield* session(request, second)).status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect("ignores a replayed token", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const token = yield* logoutToken({ sid: undefined, sub: "user-1" });
      assert.strictEqual((yield* post(request, token)).status, 200);
      // A session started after the logout survives the replay.
      const sessionCookie = yield* login(request);
      assert.strictEqual((yield* post(request, token)).status, 200);
      assert.strictEqual((yield* session(request, sessionCookie)).status, 200);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects an invalid token with 400 and keeps the session", () =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const sessionCookie = yield* login(request);
      const response = yield* post(
        request,
        yield* logoutToken({ aud: "another-client" }),
      );
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        error: "invalid_request",
        error_description: "Invalid logout token",
      });
      assert.strictEqual((yield* session(request, sessionCookie)).status, 200);
    }).pipe(Effect.scoped),
  );
});
