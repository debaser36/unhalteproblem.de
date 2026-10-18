import { assert, describe, it } from "@effect/vitest";
import {
  Authentication,
  Authorized,
  CurrentUser,
  Forbidden,
  RequireRoles,
  type Role,
  Unauthorized,
} from "@unhalteproblem.de/api";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import * as Authorization from "./Authorization.ts";

const asUser = (roles: ReadonlyArray<Role>) =>
  Effect.provideService(CurrentUser, {
    user: { id: "user-1", roles },
    expiresAt: DateTime.nowUnsafe(),
  });

// Domain code that declares what it needs.
const adminOnly = Effect.map(Authorized("admin"), ({ roles }) => roles);
const adminOrSuperAdmin = Effect.map(
  Authorized("admin", "superAdmin"),
  ({ roles }) => roles,
);
const adminAndSuperAdmin = Effect.gen(function* () {
  yield* Authorized("admin");
  yield* Authorized("superAdmin");
  return "both";
});

describe("Authorization.provide", () => {
  it.effect("lets a user with the role through", () =>
    Effect.gen(function* () {
      const roles = yield* adminOnly.pipe(
        Authorization.provide("admin"),
        asUser(["admin", "normalUser"]),
      );
      assert.deepStrictEqual(roles, ["admin"]);
    }),
  );

  it.effect("refuses a user without the role with Forbidden", () =>
    Effect.gen(function* () {
      const error = yield* adminOnly.pipe(
        Authorization.provide("admin"),
        asUser(["normalUser"]),
        Effect.flip,
      );
      assert.instanceOf(error, Forbidden);
    }),
  );

  it.effect("any-of: one of the roles is enough", () =>
    Effect.gen(function* () {
      const roles = yield* adminOrSuperAdmin.pipe(
        // The order doesn't matter: it is the same requirement.
        Authorization.provide("superAdmin", "admin"),
        asUser(["superAdmin"]),
      );
      assert.deepStrictEqual(roles, ["superAdmin"]);
    }),
  );

  it.effect("all-of: every proof is checked", () =>
    Effect.gen(function* () {
      const run = (roles: ReadonlyArray<Role>) =>
        adminAndSuperAdmin.pipe(
          Authorization.provide("admin"),
          Authorization.provide("superAdmin"),
          asUser(roles),
        );
      assert.strictEqual(yield* run(["admin", "superAdmin"]), "both");
      assert.instanceOf(yield* Effect.flip(run(["admin"])), Forbidden);
      assert.instanceOf(yield* Effect.flip(run(["superAdmin"])), Forbidden);
    }),
  );

  it.effect("Authorization.layer checks when it is built", () =>
    Effect.gen(function* () {
      const run = (roles: ReadonlyArray<Role>) =>
        adminOnly.pipe(
          Effect.provide(Authorization.layer("admin")),
          asUser(roles),
        );
      assert.deepStrictEqual(yield* run(["admin"]), ["admin"]);
      assert.instanceOf(yield* Effect.flip(run([])), Forbidden);
    }),
  );
});

describe("Authorization.middleware", () => {
  const RequireAdmin = RequireRoles("admin");
  const RequireStaff = RequireRoles("admin", "superAdmin");

  class AdminGroup extends HttpApiGroup.make("admin")
    .add(
      HttpApiEndpoint.get("dashboard", "/admin", {
        success: Schema.Array(Schema.String),
      }).middleware(RequireAdmin),
    )
    .add(
      HttpApiEndpoint.get("staff", "/staff", {
        success: Schema.Array(Schema.String),
      }).middleware(RequireStaff),
    )
    .middleware(Authentication) {}
  class TestApi extends HttpApi.make("test").add(AdminGroup) {}

  // Stands in for the session lookup: the cookie names the roles.
  const AuthenticationStub = Layer.succeed(Authentication, {
    session: (httpEffect, { credential }) => {
      const value = Redacted.value(credential);
      if (value === "") return Effect.fail(new Unauthorized());
      return httpEffect.pipe(
        asUser(value === "none" ? [] : (value.split(",") as Array<Role>)),
      );
    },
  });

  const makeApp = Effect.gen(function* () {
    const handlers = HttpApiBuilder.group(TestApi, "admin", (handlers) =>
      // The handler can run code that requires the proof.
      handlers
        .handle("dashboard", () => adminOnly)
        .handle("staff", () => adminOrSuperAdmin),
    ).pipe(
      Layer.provide([
        Authorization.middleware(RequireAdmin),
        Authorization.middleware(RequireStaff),
        AuthenticationStub,
      ]),
    );
    const app = HttpApiBuilder.layer(TestApi).pipe(
      Layer.provide(handlers),
      Layer.provide(HttpServer.layerServices),
    );
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
      ({ dispose }) => Effect.promise(dispose),
    );
    return (cookie?: string, path = "/admin") =>
      Effect.promise(() =>
        handler(
          new Request(`http://localhost${path}`, {
            headers:
              cookie === undefined
                ? {}
                : { cookie: `__Host-session=${cookie}` },
          }),
        ),
      );
  });

  it.effect("401 without a session, 403 without the role, 200 with it", () =>
    Effect.gen(function* () {
      const request = yield* makeApp;
      assert.strictEqual((yield* request()).status, 401);
      assert.strictEqual((yield* request("normalUser")).status, 403);
      assert.strictEqual((yield* request("none")).status, 403);
      const ok = yield* request("admin,normalUser");
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(yield* Effect.promise(() => ok.json()), ["admin"]);
    }).pipe(Effect.scoped),
  );

  it.effect("any-of: one of the endpoint's roles is enough", () =>
    Effect.gen(function* () {
      const request = yield* makeApp;
      const staff = (cookie: string) => request(cookie, "/staff");
      assert.strictEqual((yield* staff("normalUser")).status, 403);
      const admin = yield* staff("admin");
      assert.strictEqual(admin.status, 200);
      assert.deepStrictEqual(yield* Effect.promise(() => admin.json()), [
        "admin",
      ]);
      const superAdmin = yield* staff("superAdmin");
      assert.deepStrictEqual(yield* Effect.promise(() => superAdmin.json()), [
        "superAdmin",
      ]);
    }).pipe(Effect.scoped),
  );
});
