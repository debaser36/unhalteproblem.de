import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { HttpClientRequest, HttpServer, HttpServerRequest } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiMiddleware,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import { Api } from "#Api";
import { Authentication, CurrentUser, SessionCookie } from "#Authentication";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";
import type { Role } from "#domain/Auth";
import { AccountDeletionNotAllowed } from "#errors/AccountDeletionNotAllowed";
import { Forbidden } from "#errors/Forbidden";
import { Unauthorized } from "#errors/Unauthorized";
import { SameOrigin } from "#SameOrigin";

describe("account endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  const operation = spec.paths["/account/delete"]?.post;

  it("exposes POST /account/delete as account.deleteAccount", () => {
    assert.deepStrictEqual(Object.keys(spec.paths["/account/delete"] ?? {}), [
      "post",
    ]);
    assert.strictEqual(operation?.operationId, "account.deleteAccount");
  });

  it("documents 204, 401, 403 and 409", () => {
    assert.deepStrictEqual(Object.keys(operation?.responses ?? {}).sort(), [
      "204",
      "401",
      "403",
      "409",
    ]);
  });

  it("answers 204 without a body and takes no request body", () => {
    assert.isUndefined(operation?.responses["204"]?.content);
    assert.isUndefined(operation?.requestBody);
    assert.deepStrictEqual(operation?.parameters ?? [], []);
  });

  it("requires the session cookie", () => {
    assert.deepStrictEqual(operation?.security, [{ session: [] }]);
  });

  it("answers 409 with AccountDeletionNotAllowed and its reason", () => {
    assert.deepStrictEqual(
      operation?.responses["409"]?.content?.["application/json"]?.schema,
      { $ref: "#/components/schemas/AccountDeletionNotAllowedEncoded" },
    );
    const error = spec.components.schemas[
      "AccountDeletionNotAllowedEncoded"
    ] as {
      readonly properties?: Record<string, unknown>;
      readonly required?: ReadonlyArray<string>;
    };
    assert.deepStrictEqual(Object.keys(error.properties ?? {}).sort(), [
      "_tag",
      "reason",
    ]);
    assert.deepStrictEqual(error.properties?.["reason"], {
      anyOf: [{ type: "string", enum: ["superAdmin"] }],
    });
  });

  it("describes what the deletion does", () => {
    for (const text of ["sessions", "profile", "identity provider", "401"]) {
      assert.include(operation?.description, text);
    }
  });
});

describe("account endpoint middleware", () => {
  it("has Authentication and SameOrigin on deleteAccount", () => {
    const middlewares = new Map<string, Array<string>>();
    HttpApi.reflect(Api, {
      onGroup: () => {},
      onEndpoint: ({ group, endpoint, middleware }) => {
        middlewares.set(
          `${group.identifier}.${endpoint.identifier}`,
          [...middleware].map((m) => m.key).sort(),
        );
      },
    });
    assert.deepStrictEqual(
      middlewares.get("account.deleteAccount"),
      [Authentication.key, SameOrigin.key].sort(),
    );
  });
});

// Stub handler and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. The real ones live in the backend.

const site = "https://unhalteproblem.de";

// Fails like the backend does for a superAdmin; succeeds otherwise.
const AccountHandlers = HttpApiBuilder.group(Api, "account", (handlers) =>
  handlers.handle("deleteAccount", () =>
    Effect.gen(function* () {
      const { user } = yield* CurrentUser;
      if (user.roles.includes("superAdmin")) {
        return yield* new AccountDeletionNotAllowed({ reason: "superAdmin" });
      }
    }),
  ),
);

// Session ids are the user's roles, comma-separated.
const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) => {
    const value = Redacted.value(credential);
    return value === ""
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(httpEffect, CurrentUser, {
          user: { id: "session-user", roles: value.split(",") as Array<Role> },
          expiresAt: DateTime.makeUnsafe("2026-02-01T10:00:00Z"),
        });
  },
});

const SameOriginStub = Layer.succeed(SameOrigin, (httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return request.headers["origin"] === site
      ? yield* httpEffect
      : yield* new Forbidden();
  }),
);

const withSession = (roles: string) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(
      HttpClientRequest.setHeader(
        request,
        "cookie",
        `${SessionCookie}=${roles}`,
      ),
    ),
  );

// Browsers set `Origin` by themselves; the in-memory client does not.
const withOrigin = (origin: string) =>
  HttpApiMiddleware.layerClient(SameOrigin, ({ next, request }) =>
    next(HttpClientRequest.setHeader(request, "origin", origin)),
  );

// The in-memory server needs an implementation of every middleware of the
// API, but the admin group's are never reached here.
const unusedMiddleware = Effect.die("not used by these tests");
const AdminMiddlewareStubs = Layer.mergeAll(
  Layer.succeed(RequireAdmin, () => unusedMiddleware),
  Layer.succeed(RequireSuperAdmin, () => unusedMiddleware),
);

const makeClient = HttpApiTest.groups(Api, ["account"]);

layer(
  Layer.mergeAll(
    AccountHandlers.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          SameOriginStub,
          AdminMiddlewareStubs,
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("account client round trip", (it) => {
  it.effect("deleteAccount answers 204 without a body", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.account.deleteAccount({
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 204);
      assert.strictEqual(yield* response.text, "");
      assert.isUndefined(yield* client.account.deleteAccount());
    }).pipe(
      Effect.provide(
        Layer.mergeAll(withSession("normalUser"), withOrigin(site)),
      ),
    ),
  );

  it.effect("deleteAccount fails with AccountDeletionNotAllowed", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.account.deleteAccount({
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* response.json, {
        _tag: "AccountDeletionNotAllowed",
        reason: "superAdmin",
      });
      const error = yield* client.account.deleteAccount().pipe(Effect.flip);
      assert.deepStrictEqual(
        error,
        new AccountDeletionNotAllowed({ reason: "superAdmin" }),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(withSession("normalUser,superAdmin"), withOrigin(site)),
      ),
    ),
  );

  it.effect("deleteAccount answers 401 without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.account.deleteAccount().pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }).pipe(Effect.provide(withOrigin(site))),
  );

  it.effect("deleteAccount answers 403 without an Origin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.account.deleteAccount().pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(withSession("normalUser"))),
  );

  it.effect("deleteAccount answers 403 for a foreign Origin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.account.deleteAccount().pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          withSession("normalUser"),
          withOrigin("https://auth.unhalteproblem.de"),
        ),
      ),
    ),
  );
});
