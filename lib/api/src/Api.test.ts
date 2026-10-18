import { assert, describe, it, layer } from "@effect/vitest";
import {
  AuthorizationCode,
  BackchannelLogoutRequest,
  OAuthBadRequest,
} from "@unhalteproblem.de/oidc";
import { DateTime, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { HttpClientRequest, HttpServer, HttpServerResponse } from "effect/http";
import {
  HttpApiBuilder,
  HttpApiMiddleware,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import { Api } from "./Api.ts";
import {
  Authentication,
  CurrentUser,
  RateLimited,
  RequireAdmin,
  RequireSuperAdmin,
  SameOrigin,
  SessionCookie,
  type SessionInfo,
  Unauthorized,
} from "./index.ts";

describe("OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);

  it("exposes exactly the contract's paths and operations", () => {
    assert.deepStrictEqual(Object.keys(spec.paths).sort(), [
      "/admin/users",
      "/admin/users/{userId}",
      "/admin/users/{userId}/restriction",
      "/admin/users/{userId}/restriction/lift",
      "/admin/users/{userId}/roles/{role}",
      "/auth/backchannel-logout",
      "/auth/callback",
      "/auth/login",
      "/auth/logout",
      "/auth/register",
      "/auth/session",
      "/contact",
      "/health",
    ]);
    const operations = Object.fromEntries(
      Object.entries(spec.paths).map(([path, item]) => [
        path,
        Object.fromEntries(
          Object.entries(item ?? {}).map(([method, operation]) => [
            method,
            (operation as { operationId?: string }).operationId,
          ]),
        ),
      ]),
    );
    // Operation ids follow the generated client's method names.
    assert.deepStrictEqual(operations, {
      "/health": { get: "health" },
      "/contact": { post: "contact.submit" },
      "/auth/session": { get: "auth.session" },
      "/auth/login": { get: "auth.login" },
      "/auth/register": { get: "auth.register" },
      "/auth/callback": { get: "auth.callback" },
      "/auth/logout": { post: "auth.logout" },
      "/auth/backchannel-logout": { post: "auth.backchannelLogout" },
      "/admin/users": { get: "admin.listUsers" },
      "/admin/users/{userId}": { get: "admin.getUser" },
      "/admin/users/{userId}/restriction": { post: "admin.restrictUser" },
      "/admin/users/{userId}/restriction/lift": {
        post: "admin.liftRestriction",
      },
      "/admin/users/{userId}/roles/{role}": {
        put: "admin.grantRole",
        delete: "admin.revokeRole",
      },
    });
  });

  it("documents the response statuses", () => {
    const statuses = (path: string, method: "get" | "post") =>
      Object.keys(spec.paths[path]?.[method]?.responses ?? {}).sort();
    assert.deepStrictEqual(statuses("/health", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/contact", "post"), ["202", "429"]);
    assert.deepStrictEqual(statuses("/auth/session", "get"), ["200", "401"]);
    assert.deepStrictEqual(statuses("/auth/login", "get"), ["302", "429"]);
    assert.deepStrictEqual(statuses("/auth/register", "get"), ["302", "429"]);
    assert.deepStrictEqual(statuses("/auth/callback", "get"), ["302"]);
    assert.deepStrictEqual(statuses("/auth/logout", "post"), ["303", "403"]);
    assert.deepStrictEqual(statuses("/auth/backchannel-logout", "post"), [
      "200",
      "400",
    ]);
  });

  it("documents the Location header of the redirects", () => {
    const redirects = [
      spec.paths["/auth/login"]?.get?.responses["302"],
      spec.paths["/auth/register"]?.get?.responses["302"],
      spec.paths["/auth/callback"]?.get?.responses["302"],
      spec.paths["/auth/logout"]?.post?.responses["303"],
    ];
    for (const response of redirects) {
      assert.deepStrictEqual(response?.headers?.["location"], {
        schema: { type: "string" },
        required: true,
      });
    }
  });

  // The admin endpoints are checked in `groups/Admin.test.ts`.
  it("requires the session cookie on GET /auth/session, not on the public endpoints", () => {
    assert.deepStrictEqual(spec.components.securitySchemes, {
      session: {
        type: "apiKey",
        in: "cookie",
        name: SessionCookie,
        description:
          "Session cookie set by `GET /auth/callback` after a successful login.",
      },
    });
    assert.deepStrictEqual(spec.paths["/auth/session"]?.get?.security, [
      { session: [] },
    ]);
    // Public on purpose, see the comments in the groups.
    assert.deepStrictEqual(spec.paths["/health"]?.get?.security, []);
    assert.deepStrictEqual(spec.paths["/contact"]?.post?.security, []);
    assert.deepStrictEqual(spec.paths["/auth/login"]?.get?.security, []);
    assert.deepStrictEqual(spec.paths["/auth/register"]?.get?.security, []);
    assert.deepStrictEqual(spec.paths["/auth/callback"]?.get?.security, []);
    assert.deepStrictEqual(spec.paths["/auth/logout"]?.post?.security, []);
    assert.deepStrictEqual(
      spec.paths["/auth/backchannel-logout"]?.post?.security,
      [],
    );
  });

  it("documents returnTo as an optional, constrained query parameter", () => {
    for (const path of ["/auth/login", "/auth/register"]) {
      assert.deepStrictEqual(spec.paths[path]?.get?.parameters, [
        {
          name: "returnTo",
          in: "query",
          schema: { $ref: "#/components/schemas/ReturnPath" },
          required: false,
        },
      ]);
    }
    const returnPath = spec.components.schemas["ReturnPath"] as {
      readonly pattern?: string;
      readonly maxLength?: number;
    };
    assert.isString(returnPath.pattern);
    assert.strictEqual(returnPath.maxLength, 2048);
  });

  it("takes the back-channel logout token as a form-urlencoded body", () => {
    const operation = spec.paths["/auth/backchannel-logout"]?.post;
    assert.deepStrictEqual(Object.keys(operation?.requestBody?.content ?? {}), [
      "application/x-www-form-urlencoded",
    ]);
    assert.strictEqual(operation?.requestBody?.required, true);
  });

  it("documents expiresAt as a date-time string", () => {
    const sessionInfo = spec.components.schemas["SessionInfo"] as {
      readonly properties: Record<string, { readonly format?: string }>;
    };
    assert.strictEqual(
      sessionInfo.properties["expiresAt"]?.format,
      "date-time",
    );
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. Real implementations live in the
// services.

const sessionInfo: SessionInfo = {
  user: {
    id: "f1b2c3d4",
    username: "ada",
    emailVerified: true,
    roles: ["normalUser"],
  },
  expiresAt: DateTime.makeUnsafe("2026-01-01T12:00:00Z"),
};
const validSession = "valid-session";
const keycloak = "https://keycloak.example/realms/unhalteproblem";
const authorizationCode = Schema.decodeSync(AuthorizationCode)("one-time-code");
const decodeLogoutRequest = Schema.decodeSync(BackchannelLogoutRequest);
const validLogout = decodeLogoutRequest({
  logout_token: "header.claims.signature",
});
const invalidLogout = decodeLogoutRequest({ logout_token: "not-a-jwt" });

const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
);
const ContactHandlers = HttpApiBuilder.group(Api, "contact", (handlers) =>
  handlers.handle("submit", ({ payload }) =>
    payload.name === "Spammer" ? Effect.fail(new RateLimited()) : Effect.void,
  ),
);
const AuthHandlers = HttpApiBuilder.group(Api, "auth", (handlers) =>
  handlers
    .handle("session", () => Effect.service(CurrentUser))
    // The redirect endpoints return the response directly; their success
    // schemas only document it.
    .handle("login", ({ query }) =>
      query.returnTo === "/rate-limited"
        ? Effect.fail(new RateLimited())
        : Effect.succeed(
            HttpServerResponse.redirect(
              `${keycloak}/protocol/openid-connect/auth?state=${encodeURIComponent(query.returnTo ?? "/")}`,
            ),
          ),
    )
    .handle("register", ({ query }) =>
      query.returnTo === "/rate-limited"
        ? Effect.fail(new RateLimited())
        : Effect.succeed(
            HttpServerResponse.redirect(
              `${keycloak}/protocol/openid-connect/auth?prompt=create&state=${encodeURIComponent(query.returnTo ?? "/")}`,
            ),
          ),
    )
    .handle("callback", ({ query }) =>
      Effect.succeed(
        HttpServerResponse.redirect(
          "error" in query ? "/?login_error=cancelled" : "/blog",
        ),
      ),
    )
    .handle("logout", () =>
      Effect.succeed(
        HttpServerResponse.redirect(
          `${keycloak}/protocol/openid-connect/logout`,
          { status: 303 },
        ),
      ),
    )
    .handle("backchannelLogout", ({ payload }) =>
      Redacted.value(payload.logout_token) === "not-a-jwt"
        ? Effect.fail(new OAuthBadRequest({ error: "invalid_request" }))
        : Effect.void,
    ),
);

// Accepts exactly one session id; the real middleware looks it up.
const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) =>
    Redacted.value(credential) === validSession
      ? Effect.provideService(httpEffect, CurrentUser, sessionInfo)
      : Effect.fail(new Unauthorized()),
});

// Browsers attach the cookie by themselves. The in-memory client has no
// cookie jar, so the test adds the header through the client middleware.
const WithSessionCookie = HttpApiMiddleware.layerClient(
  Authentication,
  ({ next, request }) =>
    next(
      HttpClientRequest.setHeader(
        request,
        "cookie",
        `${SessionCookie}=${validSession}`,
      ),
    ),
);

// The admin group's middlewares are never reached here (see
// `groups/Admin.test.ts`), but the in-memory server needs an
// implementation of every middleware of the API.
const unusedMiddleware = Effect.die("not used by these groups");
const AdminMiddlewareStubs = Layer.mergeAll(
  Layer.succeed(RequireAdmin, () => unusedMiddleware),
  Layer.succeed(RequireSuperAdmin, () => unusedMiddleware),
  Layer.succeed(SameOrigin, () => unusedMiddleware),
);

const makeClient = HttpApiTest.groups(Api, ["system", "contact", "auth"]);

// `Layer.provideMerge`: the HTTP pipeline resolves the middleware itself when
// it builds the routes, not only the handlers.
const HandlersLayer = Layer.mergeAll(
  SystemHandlers,
  ContactHandlers,
  AuthHandlers,
).pipe(
  Layer.provideMerge(Layer.mergeAll(AuthenticationStub, AdminMiddlewareStubs)),
);

layer(Layer.mergeAll(HandlersLayer, HttpServer.layerServices))(
  "client round trip",
  (it) => {
    const message = {
      name: "Ada",
      email: "ada@example.org",
      message: "Hello!",
    };

    it.effect("health returns ok", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        assert.deepStrictEqual(yield* client.health(), { status: "ok" });
      }),
    );

    it.effect("contact.submit answers 202 without a body", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.contact.submit({
          payload: message,
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 202);
        assert.strictEqual(yield* response.text, "");
        assert.isUndefined(yield* client.contact.submit({ payload: message }));
      }),
    );

    it.effect("contact.submit surfaces RateLimited as a typed 429 error", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const payload = { ...message, name: "Spammer" };
        const response = yield* client.contact.submit({
          payload,
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 429);
        const error = yield* client.contact
          .submit({ payload })
          .pipe(Effect.flip);
        assert.instanceOf(error, RateLimited);
      }),
    );

    // The stub handler would accept anything, so a failure here means the
    // payload schema was enforced (client-side encoding or server decoding).
    it.effect("an invalid payload is rejected", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const exit = yield* client.contact
          .submit({ payload: { ...message, email: "not-an-email" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    it.effect("auth.session answers 401 Unauthorized without a cookie", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.auth.session({
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 401);
        const error = yield* client.auth.session().pipe(Effect.flip);
        assert.instanceOf(error, Unauthorized);
      }),
    );

    it.effect("auth.session answers 401 for an unknown session id", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const error = yield* client.auth.session().pipe(Effect.flip);
        assert.instanceOf(error, Unauthorized);
      }).pipe(
        Effect.provide(
          HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
            next(
              HttpClientRequest.setHeader(
                request,
                "cookie",
                `${SessionCookie}=forged`,
              ),
            ),
          ),
        ),
      ),
    );

    it.effect("auth.session returns the SessionInfo with the cookie", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.auth.session({
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(yield* response.json, {
          user: {
            id: "f1b2c3d4",
            username: "ada",
            emailVerified: true,
            roles: ["normalUser"],
          },
          expiresAt: "2026-01-01T12:00:00.000Z",
        });

        const session = yield* client.auth.session();
        assert.deepStrictEqual(session.user, sessionInfo.user);
        assert.isTrue(
          DateTime.Equivalence(session.expiresAt, sessionInfo.expiresAt),
        );
      }).pipe(Effect.provide(WithSessionCookie)),
    );

    it.effect("auth.login redirects with 302 and a Location header", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.auth.login({
          query: { returnTo: "/blog/post?x=1#y" },
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 302);
        assert.strictEqual(
          response.headers["location"],
          `${keycloak}/protocol/openid-connect/auth?state=${encodeURIComponent("/blog/post?x=1#y")}`,
        );

        // Without a returnTo, too.
        const plain = yield* client.auth.login({
          query: {},
          responseMode: "response-only",
        });
        assert.strictEqual(plain.status, 302);
      }),
    );

    it.effect("auth.login surfaces RateLimited as a typed 429 error", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const query = { returnTo: "/rate-limited" };
        const response = yield* client.auth.login({
          query,
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 429);
        const error = yield* client.auth.login({ query }).pipe(Effect.flip);
        assert.instanceOf(error, RateLimited);
      }),
    );

    it.effect("auth.login rejects an open-redirect returnTo", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        // The same call with a valid path succeeds, so the failure below
        // comes from the `ReturnPath` schema.
        const ok = yield* client.auth.login({ query: { returnTo: "/blog" } });
        assert.strictEqual(
          ok.headers.location,
          `${keycloak}/protocol/openid-connect/auth?state=%2Fblog`,
        );
        const exit = yield* client.auth
          .login({ query: { returnTo: "//evil.example" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    it.effect("auth.register redirects with 302 and a Location header", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.auth.register({
          query: { returnTo: "/blog/post?x=1#y" },
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 302);
        assert.strictEqual(
          response.headers["location"],
          `${keycloak}/protocol/openid-connect/auth?prompt=create&state=${encodeURIComponent("/blog/post?x=1#y")}`,
        );

        // Without a returnTo, too.
        const plain = yield* client.auth.register({
          query: {},
          responseMode: "response-only",
        });
        assert.strictEqual(plain.status, 302);
      }),
    );

    it.effect("auth.register surfaces RateLimited as a typed 429 error", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const query = { returnTo: "/rate-limited" };
        const response = yield* client.auth.register({
          query,
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 429);
        const error = yield* client.auth.register({ query }).pipe(Effect.flip);
        assert.instanceOf(error, RateLimited);
      }),
    );

    it.effect("auth.register rejects an open-redirect returnTo", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        // The same call with a valid path succeeds, so the failure below
        // comes from the `ReturnPath` schema.
        const ok = yield* client.auth.register({
          query: { returnTo: "/blog" },
        });
        assert.strictEqual(
          ok.headers.location,
          `${keycloak}/protocol/openid-connect/auth?prompt=create&state=%2Fblog`,
        );
        const exit = yield* client.auth
          .register({ query: { returnTo: "//evil.example" } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    it.effect("auth.callback redirects for both callback shapes", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const failed = yield* client.auth.callback({
          query: { error: "access_denied", state: "s" },
          responseMode: "response-only",
        });
        assert.strictEqual(failed.status, 302);
        assert.strictEqual(
          failed.headers["location"],
          "/?login_error=cancelled",
        );

        const succeeded = yield* client.auth.callback({
          query: {
            code: authorizationCode,
            state: "s",
            iss: keycloak,
          },
          responseMode: "response-only",
        });
        assert.strictEqual(succeeded.status, 302);
        assert.strictEqual(succeeded.headers["location"], "/blog");
      }),
    );

    it.effect("auth.logout redirects with 303", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const response = yield* client.auth.logout({
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 303);
        assert.strictEqual(
          response.headers["location"],
          `${keycloak}/protocol/openid-connect/logout`,
        );
      }),
    );

    it.effect("auth.backchannelLogout answers 200 or a typed 400", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;

        const ok = yield* client.auth.backchannelLogout({
          payload: validLogout,
          responseMode: "response-only",
        });
        assert.strictEqual(ok.status, 200);

        const bad = invalidLogout;
        const response = yield* client.auth.backchannelLogout({
          payload: bad,
          responseMode: "response-only",
        });
        assert.strictEqual(response.status, 400);
        // RFC 6749 §5.2 wire format: no `_tag`.
        assert.deepStrictEqual(yield* response.json, {
          error: "invalid_request",
        });
        const error = yield* client.auth
          .backchannelLogout({ payload: bad })
          .pipe(Effect.flip);
        assert.instanceOf(error, OAuthBadRequest);
      }),
    );
  },
);
