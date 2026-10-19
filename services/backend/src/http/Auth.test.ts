import { assert, describe, it } from "@effect/vitest";
import { BackchannelLogoutEvent } from "@unhalteproblem.de/oidc";
import { Effect, Option } from "effect";
import type { JWTPayload } from "jose";
import { UserQueries } from "#domains/users/UserQueries";
import {
  type AppRequest,
  callback,
  clientId,
  cookieValue,
  issuer,
  login,
  loginResponse,
  makeApp,
  makeAppWithServices,
  now,
  session,
  setCookie,
  sign,
  site,
  startLogin,
} from "#testing/App";

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
          roles: ["normalUser"],
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

  it.effect("reads the roles on every request", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      const sessionCookie = yield* login(request);
      const roles = Effect.gen(function* () {
        const info = yield* session(request, sessionCookie);
        const body = yield* Effect.promise(() => info.json());
        return body.user.roles;
      });
      assert.deepStrictEqual(yield* roles, ["normalUser"]);

      // An operator grants and revokes; no new login needed.
      yield* sql(
        (sql) => sql`
          INSERT INTO user_roles (user_id, role)
          SELECT id, 'admin' FROM users WHERE subject = 'user-1'
        `,
      );
      assert.deepStrictEqual(yield* roles, ["admin", "normalUser"]);
      yield* sql((sql) => sql`DELETE FROM user_roles WHERE role = 'admin'`);
      assert.deepStrictEqual(yield* roles, ["normalUser"]);
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
      assert.strictEqual(response.headers.get("location"), `${issuer}/logout`);
      assert.include(setCookie(response, "__Host-session") ?? "", "Max-Age=0");
      assert.strictEqual((yield* session(request, sessionCookie)).status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [string, Record<string, string>]>([
    ["no session cookie", {}],
    ["a session cookie nobody knows", { cookie: "__Host-session=unknown" }],
  ])("works with %s and still clears the cookie", ([, headers]) =>
    Effect.gen(function* () {
      const request = yield* makeApp();
      const response = yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site, ...headers },
      });
      assert.strictEqual(response.status, 303);
      assert.strictEqual(response.headers.get("location"), `${issuer}/logout`);
      assert.include(setCookie(response, "__Host-session") ?? "", "Max-Age=0");
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

  const post = (request: AppRequest, token: string) =>
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

describe("auth audit log", () => {
  const auditRows = (
    sql: <A>(
      statement: (
        sql: import("effect/sql").SqlClient.SqlClient,
      ) => Effect.Effect<A, unknown>,
    ) => Effect.Effect<A>,
  ) =>
    sql(
      (sql) => sql<{
        readonly action: string;
        readonly actorId: string | null;
        readonly targetId: string | null;
        readonly detail: string | null;
      }>`
        SELECT action, actor_id, target_id, detail FROM audit_log ORDER BY id
      `,
    );

  it.effect("records a login and a logout of the same user", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      const sessionCookie = yield* login(request);
      yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site, cookie: `__Host-session=${sessionCookie}` },
      });

      const rows = yield* auditRows(sql);
      assert.deepStrictEqual(
        rows.map(({ action }) => action),
        ["login", "logout"],
      );
      const [first, second] = rows;
      assert.isNotNull(first?.actorId);
      assert.strictEqual(first?.actorId, first?.targetId);
      assert.deepStrictEqual(second, first && { ...first, action: "logout" });
    }).pipe(Effect.scoped),
  );

  it.effect("records neither for a logout without a session", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      yield* request("/auth/logout", {
        method: "POST",
        headers: { origin: site, cookie: "__Host-session=unknown" },
      });
      assert.deepStrictEqual(yield* auditRows(sql), []);
    }).pipe(Effect.scoped),
  );

  it.effect("records a refused login of a restricted user", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      yield* login(request);
      yield* sql(
        (sql) => sql`
          INSERT INTO user_restrictions (id, user_id, note, restricted_at)
          SELECT gen_random_uuid(), id, 'x', now() FROM users
          WHERE subject = 'user-1'
        `,
      );
      const response = yield* loginResponse(request);
      assert.include(response.headers.get("location") ?? "", "restricted");

      const refused = (yield* auditRows(sql)).filter(
        ({ action }) => action === "login_refused",
      );
      assert.strictEqual(refused.length, 1);
      assert.isNull(refused[0]?.actorId);
      assert.isNotNull(refused[0]?.targetId);
      assert.strictEqual(refused[0]?.detail, "restricted");
    }).pipe(Effect.scoped),
  );
});
