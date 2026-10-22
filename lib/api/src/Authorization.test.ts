import { assert, describe, it, layer } from "@effect/vitest";
import {
  Array as Arr,
  DateTime,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { HttpClientRequest, type HttpRouter, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import { expectTypeOf } from "vitest";
import {
  Authentication,
  CurrentUser,
  SessionCookie,
} from "./Authentication.ts";
import {
  type Authorization,
  Authorized,
  RequireRoles,
} from "./Authorization.ts";
import { blogEditorRole, type Role, type User } from "#domain/Auth";
import type { BlogSlug } from "#domain/Blog";
import { Forbidden } from "#errors/Forbidden";
import { Unauthorized } from "#errors/Unauthorized";

const admin: User = { id: "admin-1", roles: ["normalUser", "admin"] };

describe("Authorized", () => {
  it("returns the same service for the same role set", () => {
    assert.strictEqual(Authorized("admin"), Authorized("admin"));
    assert.strictEqual(Authorized("admin", "admin"), Authorized("admin"));
    assert.strictEqual(
      Authorized("admin", "superAdmin"),
      Authorized("superAdmin", "admin"),
    );
    assert.strictEqual(
      Authorized("superAdmin", "admin", "superAdmin"),
      Authorized("admin", "superAdmin"),
    );
  });

  it("returns distinct services for different role sets", () => {
    assert.notStrictEqual<unknown>(
      Authorized("admin"),
      Authorized("superAdmin"),
    );
    assert.notStrictEqual<unknown>(
      Authorized("admin"),
      Authorized("admin", "superAdmin"),
    );
  });

  it("uses canonical keys", () => {
    assert.strictEqual(
      Authorized("admin").key,
      "@unhalteproblem.de/api/Authorized(admin)",
    );
    assert.strictEqual(
      Authorized("superAdmin", "normalUser", "admin", "normalUser").key,
      "@unhalteproblem.de/api/Authorized(admin,normalUser,superAdmin)",
    );
  });

  it("keys blog editor roles by their slug", () => {
    assert.strictEqual(
      Authorized(blogEditorRole("rust-notes"), "admin").key,
      "@unhalteproblem.de/api/Authorized(admin,blogEditor:rust-notes)",
    );
    // A literal role keeps its literal type, but is the same service.
    assert.strictEqual<unknown>(
      Authorized(blogEditorRole("rust-notes")),
      Authorized("blogEditor:rust-notes"),
    );
    // Same type, but distinct services: the proof for one subblog never
    // provides the one for another at runtime.
    assert.notStrictEqual(
      Authorized(blogEditorRole("rust-notes")),
      Authorized(blogEditorRole("go-notes")),
    );
  });

  it("is satisfied by the proof for the same role set, in any order", () => {
    const anyOf = Effect.gen(function* () {
      const { user, roles } = yield* Authorized("admin", "superAdmin");
      return { id: user.id, roles };
    });
    const exit = Effect.runSyncExit(
      anyOf.pipe(
        Effect.provideService(Authorized("superAdmin", "admin"), {
          user: admin,
          roles: ["admin"],
        }),
      ),
    );
    assert.deepStrictEqual(
      exit,
      Exit.succeed({ id: "admin-1", roles: ["admin"] as const }),
    );
  });

  it("is not satisfied by the proof for another role set", () => {
    const anyOf = Effect.asVoid(Authorized("admin", "superAdmin"));
    const provided = anyOf.pipe(
      Effect.provideService(Authorized("admin"), {
        user: admin,
        roles: ["admin"],
      }),
    );
    // Still requires `Authorized<"admin" | "superAdmin">`, see the type tests.
    expectTypeOf<Effect.Services<typeof provided>>().toEqualTypeOf<
      Authorized<"admin" | "superAdmin">
    >();
    const exit = Effect.runSyncExit(
      provided as Effect.Effect<void, never, never>,
    );
    assert.isTrue(Exit.isFailure(exit));
  });
});

describe("RequireRoles", () => {
  it("returns the same middleware for the same role set", () => {
    assert.strictEqual(RequireRoles("admin"), RequireRoles("admin", "admin"));
    assert.strictEqual(
      RequireRoles("admin", "superAdmin"),
      RequireRoles("superAdmin", "admin"),
    );
  });

  it("returns distinct middlewares for different role sets", () => {
    assert.notStrictEqual<unknown>(
      RequireRoles("admin"),
      RequireRoles("superAdmin"),
    );
    assert.notStrictEqual<unknown>(
      RequireRoles("admin"),
      RequireRoles("admin", "superAdmin"),
    );
  });

  it("uses canonical keys and roles", () => {
    const middleware = RequireRoles("superAdmin", "admin", "superAdmin");
    assert.strictEqual(
      middleware.key,
      "@unhalteproblem.de/api/RequireRoles(admin,superAdmin)",
    );
    assert.deepStrictEqual(middleware.roles, ["admin", "superAdmin"]);
  });

  it("provides the matching Authorized service", () => {
    assert.strictEqual(
      RequireRoles("superAdmin", "admin").authorized,
      Authorized("admin", "superAdmin"),
    );
  });

  it("fails with Forbidden and needs no client middleware", () => {
    const middleware = RequireRoles("admin");
    assert.deepStrictEqual([...middleware.error], [Forbidden]);
    assert.isFalse(middleware.requiredForClient);
    assert.isFalse("security" in middleware);
  });
});

// A test API in the documented shape: the endpoint requires a role, the
// group's `Authentication` comes after it and runs first.

const RequireAdmin = RequireRoles("admin");

const Stats = Schema.Struct({ users: Schema.Finite });

class AdminGroup extends HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("stats", "/admin/stats", {
      success: Stats,
      error: [],
    }).middleware(RequireAdmin),
  )
  .middleware(Authentication) {}

const TestApi = HttpApi.make("test").add(AdminGroup);

describe("OpenAPI document of an endpoint with RequireRoles", () => {
  const spec = OpenApi.fromApi(TestApi);

  it("documents 401 from Authentication and 403 from RequireRoles", () => {
    assert.deepStrictEqual(
      Object.keys(spec.paths["/admin/stats"]?.get?.responses ?? {}).sort(),
      ["200", "401", "403"],
    );
  });

  it("requires the session cookie", () => {
    assert.deepStrictEqual(spec.paths["/admin/stats"]?.get?.security, [
      { session: [] },
    ]);
  });
});

// Stub implementations in the shape the backend uses. A domain operation
// that declares "admins only" in its requirements:
const countUsers = Effect.gen(function* () {
  yield* Authorized("admin");
  return { users: 42 };
});

const AdminHandlers = HttpApiBuilder.group(TestApi, "admin", (handlers) =>
  handlers.handle("stats", () => countUsers),
);

// Session ids are the user's roles, comma-separated; the real middleware
// looks the session up.
const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) => {
    const value = Redacted.value(credential);
    return value === ""
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(httpEffect, CurrentUser, {
          user: { id: "user-1", roles: value.split(",") as Array<Role> },
          expiresAt: DateTime.makeUnsafe("2026-01-01T12:00:00Z"),
        });
  },
});

// Works for every `RequireRoles` middleware; the real one lives in the
// backend.
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

const makeClient = HttpApiTest.groups(TestApi, ["admin"]);

layer(
  Layer.mergeAll(
    AdminHandlers.pipe(
      Layer.provideMerge(
        Layer.mergeAll(AuthenticationStub, requireRolesStub(RequireAdmin)),
      ),
    ),
    HttpServer.layerServices,
  ),
)("an endpoint with RequireRoles", (it) => {
  it.effect("answers 401 Unauthorized without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.admin.stats().pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }),
  );

  it.effect("answers 403 Forbidden without the role", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.admin.stats({
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 403);
      const error = yield* client.admin.stats().pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(withSession("normalUser,superAdmin"))),
  );

  it.effect("runs the handler with the role", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.admin.stats(), { users: 42 });
    }).pipe(Effect.provide(withSession("normalUser,admin"))),
  );
});

// Type-level tests: checked by `tsc` (`check-types`), no-ops at runtime.
describe("requirement types", () => {
  it("any-of is one requirement naming several roles", () => {
    const anyOf = Effect.gen(function* () {
      const { roles } = yield* Authorized("admin", "superAdmin");
      return roles;
    });
    expectTypeOf(anyOf).toEqualTypeOf<
      Effect.Effect<
        Arr.NonEmptyReadonlyArray<"admin" | "superAdmin">,
        never,
        Authorized<"admin" | "superAdmin">
      >
    >();
    // Order and duplicates don't matter.
    expectTypeOf(Authorized("superAdmin", "admin", "admin")).toEqualTypeOf(
      Authorized("admin", "superAdmin"),
    );
  });

  it("blog editor roles are typed by their template", () => {
    const slug: BlogSlug = "rust-notes";
    const editor = Effect.gen(function* () {
      const { roles } = yield* Authorized(blogEditorRole(slug));
      return roles;
    });
    expectTypeOf(editor).toEqualTypeOf<
      Effect.Effect<
        Arr.NonEmptyReadonlyArray<`blogEditor:${string}`>,
        never,
        Authorized<`blogEditor:${string}`>
      >
    >();
    expectTypeOf(RequireRoles("admin", blogEditorRole(slug))).toEqualTypeOf<
      RequireRoles<"admin" | `blogEditor:${string}`>
    >();
    expectTypeOf<Role>().toEqualTypeOf<
      | "normalUser"
      | "admin"
      | "superAdmin"
      | "foodPlanner"
      | `blogEditor:${string}`
    >();
  });

  it("all-of is several requirements", () => {
    const allOf = Effect.gen(function* () {
      yield* Authorized("admin");
      yield* Authorized("superAdmin");
    });
    expectTypeOf<Effect.Services<typeof allOf>>().toEqualTypeOf<
      Authorized<"admin"> | Authorized<"superAdmin">
    >();
    // Each proof removes only its own requirement.
    const halfProvided = allOf.pipe(
      Effect.provideService(Authorized("admin"), {
        user: admin,
        roles: ["admin"],
      }),
    );
    expectTypeOf<Effect.Services<typeof halfProvided>>().toEqualTypeOf<
      Authorized<"superAdmin">
    >();
  });

  it("proofs for different role sets don't stand in for each other", () => {
    expectTypeOf<Authorized<"admin">>().not.toExtend<
      Authorized<"admin" | "superAdmin">
    >();
    expectTypeOf<Authorized<"admin" | "superAdmin">>().not.toExtend<
      Authorized<"admin">
    >();
    expectTypeOf<Authorized<"admin">>().not.toExtend<
      Authorized<"superAdmin">
    >();
  });

  it("the proof carries the requested roles", () => {
    expectTypeOf<Effect.Success<typeof countUsers>>().toEqualTypeOf<{
      users: number;
    }>();
    expectTypeOf(Authorized("admin", "superAdmin").Service).toEqualTypeOf<
      Authorization<"admin" | "superAdmin">
    >();
    expectTypeOf(RequireRoles("superAdmin", "admin").roles).toEqualTypeOf<
      Arr.NonEmptyReadonlyArray<"admin" | "superAdmin">
    >();
  });

  it("RequireRoles must run inside Authentication", () => {
    const endpoint = HttpApiEndpoint.get("stats", "/stats", {
      success: Stats,
      error: [],
    });
    const inside = endpoint.middleware(RequireAdmin).middleware(Authentication);
    const outside = endpoint
      .middleware(Authentication)
      .middleware(RequireAdmin);
    expectTypeOf<
      HttpApiEndpoint.MiddlewareServices<typeof inside>
    >().toEqualTypeOf<never>();
    // In the wrong order, nothing provides `CurrentUser` to `RequireAdmin`.
    expectTypeOf<
      HttpApiEndpoint.MiddlewareServices<typeof outside>
    >().toEqualTypeOf<CurrentUser>();
  });

  it("handlers get the proof of their endpoint's RequireRoles only", () => {
    // The handler's `Authorized<"admin">` is provided by `RequireAdmin`; the
    // layer needs only the middleware implementations.
    type Middlewares = RequireRoles<"admin">["Identifier"] | Authentication;
    expectTypeOf<
      Layer.Services<typeof AdminHandlers>
    >().toEqualTypeOf<Middlewares>();
    // A handler that needs another role set keeps it as an unmet requirement.
    const needsAnyOf = HttpApiBuilder.group(TestApi, "admin", (handlers) =>
      handlers.handle("stats", () =>
        Effect.as(Authorized("admin", "superAdmin"), { users: 1 }),
      ),
    );
    expectTypeOf<Layer.Services<typeof needsAnyOf>>().toEqualTypeOf<
      | Middlewares
      | HttpRouter.Request<"Requires", Authorized<"admin" | "superAdmin">>
    >();
  });

  it("the backend must implement every RequireRoles middleware", () => {
    expectTypeOf<
      Extract<
        Effect.Services<typeof makeClient>,
        RequireRoles<"admin">["Identifier"]
      >
    >().not.toBeNever();
  });
});
