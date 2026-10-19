import { assert, describe, it, layer } from "@effect/vitest";
import {
  Array as Arr,
  Cause,
  DateTime,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { HttpClientRequest, HttpServer, HttpServerRequest } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiError,
  HttpApiMiddleware,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import { Api } from "#Api";
import { Authentication, CurrentUser, SessionCookie } from "#Authentication";
import { type RequireRoles } from "#Authorization";
import {
  type Restriction,
  UserCursor,
  UserCursorMaxLength,
  UserId,
  type UserPageQuery,
} from "#domain/Admin";
import { blogEditorRole, type Role } from "#domain/Auth";
import { AlreadyRestricted } from "#errors/AlreadyRestricted";
import { Forbidden } from "#errors/Forbidden";
import { NotRestricted } from "#errors/NotRestricted";
import { RestrictionNotAllowed } from "#errors/RestrictionNotAllowed";
import { RoleChangeNotAllowed } from "#errors/RoleChangeNotAllowed";
import { Unauthorized } from "#errors/Unauthorized";
import { UserNotFound } from "#errors/UserNotFound";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";

const stateChanging = [
  "admin.restrictUser",
  "admin.liftRestriction",
  "admin.grantRole",
  "admin.revokeRole",
];

describe("admin endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "put" | "delete";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/admin/users", "get"), [
      "200",
      "401",
      "403",
    ]);
    assert.deepStrictEqual(statuses("/admin/users/{userId}", "get"), [
      "200",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(
      statuses("/admin/users/{userId}/restriction", "post"),
      ["201", "401", "403", "404", "409"],
    );
    assert.deepStrictEqual(
      statuses("/admin/users/{userId}/restriction/lift", "post"),
      ["200", "401", "403", "404", "409"],
    );
    assert.deepStrictEqual(
      statuses("/admin/users/{userId}/roles/{role}", "put"),
      ["204", "401", "403", "404"],
    );
    assert.deepStrictEqual(
      statuses("/admin/users/{userId}/roles/{role}", "delete"),
      ["204", "401", "403", "404", "409"],
    );
  });

  it("requires the session cookie on every admin endpoint", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!path.startsWith("/admin/")) continue;
      for (const op of Object.values(item ?? {})) {
        assert.deepStrictEqual(
          (op as { security?: unknown }).security,
          [{ session: [] }],
          path,
        );
      }
    }
  });

  it("answers 403 with Forbidden and RestrictionNotAllowed on restrictions", () => {
    for (const path of [
      "/admin/users/{userId}/restriction",
      "/admin/users/{userId}/restriction/lift",
    ]) {
      assert.deepStrictEqual(
        operation(path, "post")?.responses["403"]?.content?.["application/json"]
          ?.schema,
        {
          anyOf: [
            { $ref: "#/components/schemas/RestrictionNotAllowedEncoded" },
            { $ref: "#/components/schemas/ForbiddenEncoded" },
          ],
        },
      );
    }
  });

  it("returns the one Restriction component with 201 and 200", () => {
    const created = operation("/admin/users/{userId}/restriction", "post")
      ?.responses["201"]?.content?.["application/json"]?.schema as {
      readonly anyOf?: ReadonlyArray<unknown>;
    };
    assert.deepStrictEqual(created.anyOf, [
      { $ref: "#/components/schemas/Restriction" },
    ]);
    assert.deepStrictEqual(
      operation("/admin/users/{userId}/restriction/lift", "post")?.responses[
        "200"
      ]?.content?.["application/json"]?.schema,
      { $ref: "#/components/schemas/Restriction" },
    );
    assert.isFalse(
      Object.keys(spec.components.schemas).some((name) => /_\d+$/.test(name)),
    );
  });

  it("answers 204 without a body for role changes", () => {
    for (const method of ["put", "delete"] as const) {
      const response = operation("/admin/users/{userId}/roles/{role}", method)
        ?.responses["204"];
      assert.isUndefined(response?.content);
    }
  });

  it("documents the path parameters", () => {
    assert.deepStrictEqual(
      operation("/admin/users/{userId}/roles/{role}", "put")?.parameters,
      [
        {
          name: "userId",
          in: "path",
          schema: { $ref: "#/components/schemas/UserId" },
          required: true,
        },
        {
          name: "role",
          in: "path",
          schema: { $ref: "#/components/schemas/Role" },
          required: true,
        },
      ],
    );
    const userId = spec.components.schemas["UserId"] as {
      readonly format?: string;
    };
    assert.strictEqual(userId.format, "uuid");
  });

  it("documents the global and the blog editor roles", () => {
    const { description: _, ...role } = spec.components.schemas["Role"] as {
      readonly description?: string;
    };
    assert.deepStrictEqual(role, {
      anyOf: [
        { $ref: "#/components/schemas/GlobalRole" },
        { $ref: "#/components/schemas/BlogEditorRole" },
      ],
    });
    assert.deepStrictEqual(
      (spec.components.schemas["GlobalRole"] as { readonly enum?: unknown })
        .enum,
      ["normalUser", "admin", "superAdmin"],
    );
  });

  it("documents limit and cursor as optional string query parameters", () => {
    const parameters = operation("/admin/users", "get")?.parameters ?? [];
    assert.deepStrictEqual(
      parameters.map(({ name, in: location, required }) => ({
        name,
        location,
        required,
      })),
      [
        { name: "limit", location: "query", required: false },
        { name: "cursor", location: "query", required: false },
      ],
    );
  });

  it("documents the cursor as a bounded string and the page without a total", () => {
    const cursor = spec.components.schemas["UserCursorEncoded"] as {
      readonly type?: string;
      readonly maxLength?: number;
    };
    assert.strictEqual(cursor.type, "string");
    assert.strictEqual(cursor.maxLength, UserCursorMaxLength);

    const parameters = operation("/admin/users", "get")?.parameters ?? [];
    assert.deepStrictEqual(
      parameters.find(({ name }) => name === "cursor")?.schema,
      { $ref: "#/components/schemas/UserCursorEncoded" },
    );

    const page = spec.components.schemas["UserPage"] as {
      readonly properties?: Record<string, unknown>;
      readonly required?: ReadonlyArray<string>;
    };
    assert.deepStrictEqual(Object.keys(page.properties ?? {}), [
      "users",
      "nextCursor",
    ]);
    assert.deepStrictEqual(page.required, ["users", "nextCursor"]);
    assert.deepStrictEqual(page.properties?.["nextCursor"], {
      anyOf: [
        { $ref: "#/components/schemas/UserCursorEncoded" },
        { type: "null" },
      ],
    });
  });

  it("takes JSON payloads for restrictions", () => {
    for (const [path, ref] of [
      ["/admin/users/{userId}/restriction", "RestrictPayload"],
      ["/admin/users/{userId}/restriction/lift", "LiftRestrictionPayload"],
    ] as const) {
      const body = operation(path, "post")?.requestBody;
      assert.deepStrictEqual(body?.content?.["application/json"]?.schema, {
        $ref: `#/components/schemas/${ref}`,
      });
    }
  });
});

describe("admin endpoint middleware", () => {
  // Middleware keys per endpoint, for the whole API. Group middleware is
  // included; `SameOrigin` has no security scheme, so it is invisible in
  // the OpenAPI document and checked here instead.
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

  it("puts SameOrigin exactly on the state-changing admin endpoints", () => {
    const withSameOrigin = [...middlewares]
      .filter(
        ([name, keys]) =>
          name.startsWith("admin.") && keys.includes(SameOrigin.key),
      )
      .map(([name]) => name)
      .sort();
    assert.deepStrictEqual(withSameOrigin, [...stateChanging].sort());
  });

  it("requires admin for users and restrictions, superAdmin for roles", () => {
    const admin = [Authentication.key, RequireAdmin.key].sort();
    const superAdmin = [Authentication.key, RequireSuperAdmin.key].sort();
    assert.deepStrictEqual(middlewares.get("admin.listUsers"), admin);
    assert.deepStrictEqual(middlewares.get("admin.getUser"), admin);
    for (const name of ["admin.restrictUser", "admin.liftRestriction"]) {
      assert.deepStrictEqual(
        middlewares.get(name),
        [...admin, SameOrigin.key].sort(),
      );
    }
    for (const name of ["admin.grantRole", "admin.revokeRole"]) {
      assert.deepStrictEqual(
        middlewares.get(name),
        [...superAdmin, SameOrigin.key].sort(),
      );
    }
  });

  it("uses the canonical role middlewares", () => {
    assert.strictEqual(
      RequireAdmin.key,
      "@unhalteproblem.de/api/RequireRoles(admin)",
    );
    assert.strictEqual(
      RequireSuperAdmin.key,
      "@unhalteproblem.de/api/RequireRoles(superAdmin)",
    );
  });

  it("SameOrigin fails with Forbidden and needs no client middleware", () => {
    assert.deepStrictEqual([...SameOrigin.error], [Forbidden]);
    assert.isFalse(SameOrigin.requiredForClient);
    assert.isFalse("security" in SameOrigin);
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. Real implementations live in the
// backend.

const site = "https://unhalteproblem.de";
const adaId = UserId.make("3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60");
const graceId = UserId.make("8d7e6f5a-4b3c-4d2e-8f1a-0b9c8d7e6f5a");
const unknownId = UserId.make("00000000-0000-4000-8000-000000000000");
const t0 = DateTime.makeUnsafe("2026-01-01T12:00:00Z");
const t1 = DateTime.makeUnsafe("2026-02-01T10:00:00Z");

const restriction: Restriction = {
  id: "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
  note: "Spam in the comments.",
  restrictedBy: graceId,
  restrictedAt: t1,
  liftedAt: null,
  liftedBy: null,
  liftNote: null,
};

const ada = {
  id: adaId,
  subject: "f1b2c3d4",
  username: "ada",
  name: null,
  email: null,
  emailVerified: false,
  createdAt: t0,
  updatedAt: t0,
  lastLoginAt: t1,
  deletedAt: null,
  roles: ["normalUser"] as Array<Role>,
  restriction: null,
};

const adaCursor = { createdAt: t0, id: adaId };
const adaCursorEncoded = Schema.encodeSync(UserCursor)(adaCursor);

// Base64url without padding, as the cursor is encoded.
const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

// The decoded role of the last `grantRole` call.
let lastGrantedRole: Role | undefined;

// The decoded query of the last `listUsers` call.
let lastQuery: UserPageQuery | undefined;

const notFound = (userId: UserId) =>
  userId === unknownId
    ? Effect.fail(new UserNotFound({ userId }))
    : Effect.void;

const AdminHandlers = HttpApiBuilder.group(Api, "admin", (handlers) =>
  handlers
    .handle("listUsers", ({ query }) =>
      Effect.sync(() => {
        lastQuery = query;
        // Echoes a position after `ada` unless the request already is one.
        return {
          users: [ada],
          nextCursor: query.cursor === undefined ? adaCursor : null,
        };
      }),
    )
    .handle("getUser", ({ params }) =>
      notFound(params.userId).pipe(
        Effect.as({
          ...ada,
          restrictions: [],
          roleChanges: [
            {
              role: "normalUser" as const,
              change: "granted" as const,
              changedBy: null,
              changedAt: t0,
            },
          ],
        }),
      ),
    )
    .handle("restrictUser", ({ params, payload }) =>
      Effect.gen(function* () {
        yield* notFound(params.userId);
        if (params.userId === graceId) {
          return yield* new RestrictionNotAllowed({
            reason: "privilegedTarget",
          });
        }
        if (payload.note === "Again.") {
          return yield* new AlreadyRestricted({ userId: params.userId });
        }
        return { ...restriction, note: payload.note };
      }),
    )
    .handle("liftRestriction", ({ params, payload }) =>
      Effect.gen(function* () {
        yield* notFound(params.userId);
        if (params.userId === graceId) {
          return yield* new NotRestricted({ userId: params.userId });
        }
        return {
          ...restriction,
          liftedAt: t1,
          liftedBy: graceId,
          liftNote: payload.note ?? null,
        };
      }),
    )
    .handle("grantRole", ({ params }) =>
      Effect.sync(() => {
        lastGrantedRole = params.role;
      }).pipe(Effect.andThen(notFound(params.userId))),
    )
    .handle("revokeRole", ({ params }) =>
      Effect.gen(function* () {
        yield* notFound(params.userId);
        if (params.userId === graceId && params.role === "superAdmin") {
          return yield* new RoleChangeNotAllowed({ reason: "lastSuperAdmin" });
        }
      }),
    ),
);

// Session ids are the user's roles, comma-separated; the real middleware
// looks the session up.
const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) => {
    const value = Redacted.value(credential);
    return value === ""
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(httpEffect, CurrentUser, {
          user: { id: "session-user", roles: value.split(",") as Array<Role> },
          expiresAt: t1,
        });
  },
});

// The same check as the backend's `RequireRoles` middlewares.
const requireRolesStub = <Roles extends Role>(
  middleware: RequireRoles<Roles>,
) =>
  Layer.succeed(middleware, (httpEffect) =>
    Effect.gen(function* () {
      const { user } = yield* CurrentUser;
      const held = middleware.roles.filter((role) => user.roles.includes(role));
      if (!Arr.isReadonlyArrayNonEmpty(held)) {
        return yield* new Forbidden();
      }
      return yield* Effect.provideService(httpEffect, middleware.authorized, {
        user,
        roles: held,
      });
    }),
  );

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

const asAdmin = Layer.mergeAll(
  withSession("normalUser,admin"),
  withOrigin(site),
);
const asSuperAdmin = Layer.mergeAll(
  withSession("normalUser,superAdmin"),
  withOrigin(site),
);

const makeClient = HttpApiTest.groups(Api, ["admin"]);

layer(
  Layer.mergeAll(
    AdminHandlers.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          requireRolesStub(RequireAdmin),
          requireRolesStub(RequireSuperAdmin),
          SameOriginStub,
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("admin client round trip", (it) => {
  const query = { limit: 50 };

  it.effect("answers 401 Unauthorized without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.admin.listUsers({ query }).pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }),
  );

  it.effect("answers 403 Forbidden without admin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.admin.listUsers({
        query,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 403);
      const error = yield* client.admin
        .getUser({ params: { userId: adaId } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(withSession("normalUser,superAdmin"))),
  );

  it.effect("answers 403 Forbidden for role changes without superAdmin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.admin
        .grantRole({ params: { userId: adaId, role: "admin" } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("listUsers returns a page and passes limit and cursor", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const first = yield* client.admin.listUsers({ query: { limit: 10 } });
      assert.deepStrictEqual(first, { users: [ada], nextCursor: adaCursor });
      assert.deepStrictEqual(lastQuery, { limit: 10 });

      // The cursor makes the round trip as an opaque string and arrives
      // decoded; the last page has no next cursor.
      const last = yield* client.admin.listUsers({
        query: { limit: 10, cursor: first.nextCursor! },
      });
      assert.deepStrictEqual(last, { users: [ada], nextCursor: null });
      assert.deepStrictEqual(lastQuery, { limit: 10, cursor: adaCursor });

      const response = yield* client.admin.listUsers({
        query,
        responseMode: "response-only",
      });
      assert.deepStrictEqual(yield* response.json, {
        users: [
          {
            id: adaId,
            subject: "f1b2c3d4",
            username: "ada",
            name: null,
            email: null,
            emailVerified: false,
            createdAt: "2026-01-01T12:00:00.000Z",
            updatedAt: "2026-01-01T12:00:00.000Z",
            lastLoginAt: "2026-02-01T10:00:00.000Z",
            deletedAt: null,
            roles: ["normalUser"],
            restriction: null,
          },
        ],
        nextCursor: adaCursorEncoded,
      });
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("listUsers defaults limit when the URL has none", () =>
    Effect.gen(function* () {
      lastQuery = undefined;
      const client = yield* makeClient;
      yield* client.admin.listUsers({
        query: { limit: 7, cursor: adaCursor },
      });
      assert.deepStrictEqual(lastQuery, { limit: 50 });
    }).pipe(
      Effect.provide(
        // Sends the same GET without the query that the generated client
        // always adds.
        HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
          next(
            HttpClientRequest.get(request.url, {
              headers: { cookie: `${SessionCookie}=admin` },
            }),
          ),
        ),
      ),
    ),
  );

  // Raw query strings, so the server's decoding is tested rather than the
  // client's encoding. A real server answers such a `HttpApiSchemaError`
  // of kind `Query` with an empty 400; the in-memory client surfaces the
  // error itself.
  it.effect.each([
    ["limit=0"],
    ["limit=201"],
    ["limit=1.5"],
    ["limit=ten"],
    ["cursor="],
    ["cursor=not*base64url"],
    ["cursor=" + base64Url("not json")],
    ["cursor=" + base64Url(JSON.stringify([1767225600000]))],
    ["cursor=" + base64Url(JSON.stringify([1767225600000, "not-a-uuid"]))],
    ["cursor=" + base64Url(JSON.stringify(["x", adaId]))],
    ["cursor=" + base64Url(JSON.stringify([1.5, adaId]))],
    ["cursor=" + base64Url(JSON.stringify([1767225600000, adaId, "extra"]))],
    ["cursor=" + "A".repeat(UserCursorMaxLength + 1)],
  ])("listUsers rejects ?%s on the server", ([search]) =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const exit = yield* client.admin
        .listUsers({ query, responseMode: "response-only" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.isTrue(HttpApiError.HttpApiSchemaError.is(error));
        if (HttpApiError.HttpApiSchemaError.is(error)) {
          assert.strictEqual(error.kind, "Query");
        }
      }
    }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
          next(
            HttpClientRequest.get(`${request.url}?${search}`, {
              headers: { cookie: `${SessionCookie}=admin` },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("listUsers rejects limits out of range", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      for (const bad of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }]) {
        const exit = yield* client.admin
          .listUsers({ query: bad })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("getUser returns the details or a typed 404", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const details = yield* client.admin.getUser({
        params: { userId: adaId },
      });
      assert.strictEqual(details.id, adaId);
      assert.deepStrictEqual(details.restrictions, []);
      assert.strictEqual(details.roleChanges[0]?.changedBy, null);

      const response = yield* client.admin.getUser({
        params: { userId: unknownId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 404);
      const error = yield* client.admin
        .getUser({ params: { userId: unknownId } })
        .pipe(Effect.flip);
      assert.deepStrictEqual(error, new UserNotFound({ userId: unknownId }));
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("restrictUser answers 201 with the restriction", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const payload = { note: "Spam." };
      const response = yield* client.admin.restrictUser({
        params: { userId: adaId },
        payload,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 201);
      assert.deepStrictEqual(yield* response.json, {
        id: restriction.id,
        note: "Spam.",
        restrictedBy: graceId,
        restrictedAt: "2026-02-01T10:00:00.000Z",
        liftedAt: null,
        liftedBy: null,
        liftNote: null,
      });
      const created = yield* client.admin.restrictUser({
        params: { userId: adaId },
        payload,
      });
      assert.deepStrictEqual(created, { ...restriction, note: "Spam." });
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("restrictUser surfaces its typed errors", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const restrict = (userId: UserId, note: string) =>
        client.admin
          .restrictUser({ params: { userId }, payload: { note } })
          .pipe(Effect.flip);
      assert.deepStrictEqual(
        yield* restrict(adaId, "Again."),
        new AlreadyRestricted({ userId: adaId }),
      );
      assert.deepStrictEqual(
        yield* restrict(graceId, "Spam."),
        new RestrictionNotAllowed({ reason: "privilegedTarget" }),
      );
      assert.deepStrictEqual(
        yield* restrict(unknownId, "Spam."),
        new UserNotFound({ userId: unknownId }),
      );
      const response = yield* client.admin.restrictUser({
        params: { userId: adaId },
        payload: { note: "Again." },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 409);
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("restrictUser rejects an invalid note", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      for (const note of ["", " Spam.", "n".repeat(2001)]) {
        const exit = yield* client.admin
          .restrictUser({ params: { userId: adaId }, payload: { note } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("liftRestriction returns the lifted restriction", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const withNote = yield* client.admin.liftRestriction({
        params: { userId: adaId },
        payload: { note: "Apologised." },
      });
      assert.strictEqual(withNote.liftNote, "Apologised.");
      assert.strictEqual(withNote.liftedBy, graceId);

      const response = yield* client.admin.liftRestriction({
        params: { userId: adaId },
        payload: {},
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 200);
      const body = (yield* response.json) as { liftNote: unknown };
      assert.strictEqual(body.liftNote, null);

      const error = yield* client.admin
        .liftRestriction({ params: { userId: graceId }, payload: {} })
        .pipe(Effect.flip);
      assert.deepStrictEqual(error, new NotRestricted({ userId: graceId }));
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("grantRole and revokeRole answer 204 without a body", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const granted = yield* client.admin.grantRole({
        params: { userId: adaId, role: "admin" },
        responseMode: "response-only",
      });
      assert.strictEqual(granted.status, 204);
      assert.strictEqual(yield* granted.text, "");
      const revoked = yield* client.admin.revokeRole({
        params: { userId: adaId, role: "admin" },
        responseMode: "response-only",
      });
      assert.strictEqual(revoked.status, 204);
      assert.isUndefined(
        yield* client.admin.grantRole({
          params: { userId: adaId, role: "superAdmin" },
        }),
      );
    }).pipe(Effect.provide(asSuperAdmin)),
  );

  it.effect("grantRole and revokeRole surface their typed errors", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(
        yield* client.admin
          .grantRole({ params: { userId: unknownId, role: "admin" } })
          .pipe(Effect.flip),
        new UserNotFound({ userId: unknownId }),
      );
      const response = yield* client.admin.revokeRole({
        params: { userId: graceId, role: "superAdmin" },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(
        yield* client.admin
          .revokeRole({ params: { userId: graceId, role: "superAdmin" } })
          .pipe(Effect.flip),
        new RoleChangeNotAllowed({ reason: "lastSuperAdmin" }),
      );
    }).pipe(Effect.provide(asSuperAdmin)),
  );

  it.effect("grantRole takes a blog editor role as the path parameter", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      lastGrantedRole = undefined;
      const response = yield* client.admin.grantRole({
        params: { userId: adaId, role: blogEditorRole("rust-notes") },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 204);
      assert.strictEqual(lastGrantedRole, "blogEditor:rust-notes");

      for (const role of ["blogEditor:", "blogEditor:Rust", "blogEditor:a_b"]) {
        lastGrantedRole = undefined;
        const exit = yield* client.admin
          .grantRole({ params: { userId: adaId, role: role as Role } })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        assert.isUndefined(lastGrantedRole);
      }
    }).pipe(Effect.provide(asSuperAdmin)),
  );
  it.effect("state-changing endpoints need the site's Origin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const errors = yield* Effect.all([
        Effect.flip(
          client.admin.restrictUser({
            params: { userId: adaId },
            payload: { note: "Spam." },
          }),
        ),
        Effect.flip(
          client.admin.liftRestriction({
            params: { userId: adaId },
            payload: {},
          }),
        ),
        Effect.flip(
          client.admin.grantRole({ params: { userId: adaId, role: "admin" } }),
        ),
        Effect.flip(
          client.admin.revokeRole({
            params: { userId: adaId, role: "admin" },
          }),
        ),
      ]);
      for (const error of errors) {
        assert.instanceOf(error, Forbidden);
      }
      // Reads need none.
      assert.strictEqual(
        (yield* client.admin.listUsers({ query })).users.length,
        1,
      );
    }).pipe(Effect.provide(withSession("normalUser,admin,superAdmin"))),
  );

  it.effect("a foreign Origin is refused", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.admin
        .grantRole({ params: { userId: adaId, role: "admin" } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          withSession("superAdmin"),
          withOrigin("https://auth.unhalteproblem.de"),
        ),
      ),
    ),
  );
});
