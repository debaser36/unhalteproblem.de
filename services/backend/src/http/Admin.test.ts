import { assert, describe, it } from "@effect/vitest";
import type { Role } from "@unhalteproblem.de/api";
import { DateTime, Effect, Option } from "effect";
import { hashSecret } from "#auth/Secrets";
import { Sessions } from "#repositories/Sessions";
import {
  cookieValue,
  login,
  loginResponse,
  makeAppWithServices,
  session,
  setCookie,
  site,
} from "#testing/App";

/** An id no user has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

type Json = Record<string, unknown>;

const json = (response: Response) =>
  Effect.promise(() => response.json() as Promise<Json>);

/**
 * The app with logged-in users: `root` (admin and superAdmin), `admin`,
 * `superAdmin` (superAdmin only), `user` and `target` (normalUser only).
 */
const setup = Effect.gen(function* () {
  const app = yield* makeAppWithServices();
  const { request, sql } = app;

  /** Grants a role directly in SQL, as an operator would. */
  const grant = (subject: string, role: Role) =>
    sql(
      (sql) => sql`
        INSERT INTO user_roles (user_id, role)
        SELECT id, ${role} FROM users WHERE subject = ${subject}
      `,
    );

  /** Our id of the user with this subject. */
  const idOf = (subject: string) =>
    sql(
      (sql) => sql<{ readonly id: string }>`
        SELECT id FROM users WHERE subject = ${subject}
      `,
    ).pipe(Effect.map((rows) => rows[0]?.id ?? ""));

  const sessionCount = (subject: string) =>
    sql(
      (sql) => sql<{ readonly count: number }>`
        SELECT count(*)::int AS count FROM auth_sessions
        WHERE user_id = ${subject}
      `,
    ).pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  const member = (subject: string, ...roles: ReadonlyArray<Role>) =>
    Effect.gen(function* () {
      const cookie = yield* login(request, subject);
      for (const role of roles) yield* grant(subject, role);
      return { subject, cookie, id: yield* idOf(subject) };
    });

  const root = yield* member("root", "admin", "superAdmin");
  const admin = yield* member("admin", "admin");
  const superAdmin = yield* member("super", "superAdmin");
  const user = yield* member("user");
  const target = yield* member("target");

  /**
   * Sends an admin API request with the session cookie (none if `cookie`
   * is undefined) and, unless `origin` is `null`, the site's `Origin`.
   */
  const call = (
    cookie: string | undefined,
    method: string,
    path: string,
    options: {
      readonly body?: unknown;
      readonly origin?: string | null | undefined;
    } = {},
  ) =>
    request(path, {
      method,
      headers: {
        ...(cookie === undefined ? {} : { cookie: `__Host-session=${cookie}` }),
        ...(options.origin === null ? {} : { origin: options.origin ?? site }),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });

  const getUser = (id: string) =>
    Effect.gen(function* () {
      const response = yield* call(root.cookie, "GET", `/admin/users/${id}`);
      assert.strictEqual(response.status, 200);
      return yield* json(response);
    });

  const restrict = (actor: string, id: string, note = "Spam") =>
    call(actor, "POST", `/admin/users/${id}/restriction`, { body: { note } });

  const lift = (actor: string, id: string, note?: string) =>
    call(actor, "POST", `/admin/users/${id}/restriction/lift`, {
      body: note === undefined ? {} : { note },
    });

  const roleOf = (
    actor: string,
    method: "PUT" | "DELETE",
    id: string,
    role: string,
  ) => call(actor, method, `/admin/users/${id}/roles/${role}`);

  /** The roles `GET /auth/session` reports for this session. */
  const sessionRoles = (cookie: string) =>
    Effect.gen(function* () {
      const response = yield* session(request, cookie);
      assert.strictEqual(response.status, 200);
      const body = yield* json(response);
      return (body["user"] as Json)["roles"];
    });

  return {
    ...app,
    root,
    admin,
    superAdmin,
    user,
    target,
    grant,
    idOf,
    sessionCount,
    member,
    call,
    getUser,
    restrict,
    lift,
    roleOf,
    sessionRoles,
  };
});

/** Every admin endpoint, as a request on `id`, and the role it requires. */
const endpoints = (id: string) =>
  [
    { name: "listUsers", method: "GET", path: "/admin/users", role: "admin" },
    {
      name: "getUser",
      method: "GET",
      path: `/admin/users/${id}`,
      role: "admin",
    },
    {
      name: "restrictUser",
      method: "POST",
      path: `/admin/users/${id}/restriction`,
      body: { note: "Spam" },
      role: "admin",
    },
    {
      name: "liftRestriction",
      method: "POST",
      path: `/admin/users/${id}/restriction/lift`,
      body: {},
      role: "admin",
    },
    {
      name: "grantRole",
      method: "PUT",
      path: `/admin/users/${id}/roles/admin`,
      role: "superAdmin",
    },
    {
      name: "revokeRole",
      method: "DELETE",
      path: `/admin/users/${id}/roles/admin`,
      role: "superAdmin",
    },
  ] as const;

describe("admin access", () => {
  it.effect("every endpoint requires a session (401)", () =>
    Effect.gen(function* () {
      const { call, target } = yield* setup;
      for (const endpoint of endpoints(target.id)) {
        for (const cookie of [undefined, "unknown"]) {
          // Without Origin too: the session is checked first.
          for (const origin of [undefined, null]) {
            const response = yield* call(
              cookie,
              endpoint.method,
              endpoint.path,
              {
                body: "body" in endpoint ? endpoint.body : undefined,
                origin,
              },
            );
            assert.strictEqual(
              response.status,
              401,
              `${endpoint.name} with cookie ${cookie} and origin ${origin}`,
            );
          }
        }
      }
    }).pipe(Effect.scoped),
  );

  it.effect("every endpoint refuses a normal user (403)", () =>
    Effect.gen(function* () {
      const { call, user, target, getUser } = yield* setup;
      for (const endpoint of endpoints(target.id)) {
        const response = yield* call(
          user.cookie,
          endpoint.method,
          endpoint.path,
          {
            body: "body" in endpoint ? endpoint.body : undefined,
          },
        );
        assert.strictEqual(response.status, 403, endpoint.name);
        assert.deepStrictEqual(yield* json(response), { _tag: "Forbidden" });
      }
      const details = yield* getUser(target.id);
      assert.deepStrictEqual(details["roles"], ["normalUser"]);
      assert.isNull(details["restriction"]);
    }).pipe(Effect.scoped),
  );

  it.effect("admin endpoints need admin, role endpoints superAdmin", () =>
    Effect.gen(function* () {
      const { call, admin, superAdmin, target } = yield* setup;
      const expected = {
        // Roles are flat: superAdmin alone doesn't open the admin endpoints.
        [superAdmin.cookie]: [403, 403, 403, 403, 204, 204],
        [admin.cookie]: [200, 200, 201, 200, 403, 403],
      };
      for (const [cookie, statuses] of Object.entries(expected)) {
        const actual = [];
        for (const endpoint of endpoints(target.id)) {
          const response = yield* call(cookie, endpoint.method, endpoint.path, {
            body: "body" in endpoint ? endpoint.body : undefined,
          });
          actual.push(response.status);
        }
        assert.deepStrictEqual(actual, statuses);
      }
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [string, string | null]>([
    ["no Origin", null],
    ["a foreign Origin", "https://evil.example"],
    ["a same-site Origin", "https://auth.unhalteproblem.de"],
    ["the API's Origin", "http://backend.test"],
  ])("state-changing endpoints refuse %s (403)", ([, origin]) =>
    Effect.gen(function* () {
      const { call, root, target, getUser, sessionCount } = yield* setup;
      yield* call(
        root.cookie,
        "PUT",
        `/admin/users/${target.id}/roles/superAdmin`,
      );
      for (const endpoint of endpoints(target.id)) {
        const response = yield* call(
          root.cookie,
          endpoint.method,
          endpoint.path,
          {
            body: "body" in endpoint ? endpoint.body : undefined,
            origin,
          },
        );
        // GETs don't change state and need no Origin.
        assert.strictEqual(
          response.status,
          endpoint.method === "GET" ? 200 : 403,
          endpoint.name,
        );
      }
      const details = yield* getUser(target.id);
      assert.deepStrictEqual(details["roles"], ["normalUser", "superAdmin"]);
      assert.isNull(details["restriction"]);
      assert.strictEqual(yield* sessionCount(target.subject), 1);
    }).pipe(Effect.scoped),
  );

  it.effect("admin GET responses must not be cached", () =>
    Effect.gen(function* () {
      const { call, admin, target } = yield* setup;
      for (const path of [
        "/admin/users",
        `/admin/users/${target.id}`,
        `/admin/users/${unknownId}`,
      ]) {
        const response = yield* call(admin.cookie, "GET", path);
        assert.strictEqual(
          response.headers.get("cache-control"),
          "no-store",
          path,
        );
      }
    }).pipe(Effect.scoped),
  );
});

describe("admin listUsers", () => {
  it.effect("pages through users by registration, then id", () =>
    Effect.gen(function* () {
      const { call, sql, admin, idOf } = yield* setup;
      const subjects = ["root", "admin", "super", "user", "target"];
      // Registered in reverse login order, `user` and `super` at the same
      // instant.
      const createdAt: Record<string, string> = {
        target: "2026-01-01T00:00:00Z",
        user: "2026-01-02T00:00:00Z",
        super: "2026-01-02T00:00:00Z",
        admin: "2026-01-03T00:00:00Z",
        root: "2026-01-04T00:00:00Z",
      };
      for (const subject of subjects) {
        yield* sql(
          (sql) => sql`
            UPDATE users SET created_at = ${new Date(createdAt[subject] ?? "")}
            WHERE subject = ${subject}
          `,
        );
      }
      const ids: Record<string, string> = {};
      for (const subject of subjects) ids[subject] = yield* idOf(subject);
      const tied = [ids["user"] ?? "", ids["super"] ?? ""].sort();
      const expected = [ids["target"], ...tied, ids["admin"], ids["root"]];

      const page = (query: string) =>
        Effect.gen(function* () {
          const response = yield* call(
            admin.cookie,
            "GET",
            `/admin/users${query}`,
          );
          assert.strictEqual(response.status, 200, query);
          const body = yield* json(response);
          return {
            ids: (body["users"] as Array<Json>).map((user) => user["id"]),
            nextCursor: body["nextCursor"] as string | null,
            total: body["total"],
          };
        });

      // Everything on one page: no next cursor, and no total any more.
      const all = yield* page("");
      assert.deepStrictEqual(all, {
        ids: expected,
        nextCursor: null,
        total: undefined,
      });

      // Walking the list with the cursors the endpoint hands out.
      const seen: Array<unknown> = [];
      let query = "?limit=2";
      for (let pages = 0; pages < 10; pages++) {
        const current = yield* page(query);
        seen.push(...current.ids);
        if (current.nextCursor === null) break;
        query = `?limit=2&cursor=${current.nextCursor}`;
      }
      assert.deepStrictEqual(seen, expected);

      // A page that ends exactly at the last user has no next cursor.
      assert.strictEqual((yield* page("?limit=5")).nextCursor, null);
      const firstTwo = yield* page("?limit=2");
      assert.isString(firstTwo.nextCursor);
      assert.deepStrictEqual(
        (yield* page(`?limit=200&cursor=${firstTwo.nextCursor}`)).ids,
        expected.slice(2),
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    "limit=0",
    "limit=201",
    "limit=1.5",
    "limit=x",
    "cursor=garbage",
    "cursor=",
  ])("rejects %s with 400", (query) =>
    Effect.gen(function* () {
      const { call, admin } = yield* setup;
      const response = yield* call(
        admin.cookie,
        "GET",
        `/admin/users?${query}`,
      );
      assert.strictEqual(response.status, 400);
    }).pipe(Effect.scoped),
  );

  it.effect("lists every field, roles and the active restriction", () =>
    Effect.gen(function* () {
      const { call, admin, root, target, restrict } = yield* setup;
      const restriction = yield* json(yield* restrict(admin.cookie, target.id));
      const response = yield* call(admin.cookie, "GET", "/admin/users");
      const users = (yield* json(response))["users"] as Array<Json>;
      const byId = new Map(users.map((user) => [user["id"], user]));

      const listed = byId.get(target.id) ?? {};
      assert.deepStrictEqual(Object.keys(listed).sort(), [
        "createdAt",
        "email",
        "emailVerified",
        "id",
        "lastLoginAt",
        "name",
        "restriction",
        "roles",
        "subject",
        "updatedAt",
        "username",
      ]);
      assert.deepInclude(listed, {
        id: target.id,
        subject: "target",
        username: "ada",
        // The provider sends no name: null, not missing.
        name: null,
        email: "ada@example.org",
        emailVerified: true,
        roles: ["normalUser"],
        restriction,
      });
      for (const field of ["createdAt", "updatedAt", "lastLoginAt"]) {
        assert.match(String(listed[field]), /^\d{4}-\d\d-\d\dT.*Z$/);
      }
      assert.deepInclude(byId.get(root.id) ?? {}, {
        roles: ["admin", "normalUser", "superAdmin"],
        restriction: null,
      });
    }).pipe(Effect.scoped),
  );
});

describe("admin getUser", () => {
  it.effect("returns roles, restrictions and the role change log", () =>
    Effect.gen(function* () {
      const { root, admin, target, restrict, lift, roleOf, getUser, sql } =
        yield* setup;
      const first = yield* json(
        yield* restrict(admin.cookie, target.id, "first"),
      );
      const lifted = yield* json(
        yield* lift(root.cookie, target.id, "appealed"),
      );
      // Moves the first restriction back in time, so "newest first" doesn't
      // depend on the clock's resolution.
      yield* sql(
        (sql) => sql`
          UPDATE user_restrictions SET
            restricted_at = restricted_at - interval '1 hour',
            lifted_at = lifted_at - interval '1 hour'
          WHERE id = ${String(first["id"])}
        `,
      );
      const second = yield* json(
        yield* restrict(admin.cookie, target.id, "second"),
      );
      assert.strictEqual(
        (yield* roleOf(root.cookie, "PUT", target.id, "admin")).status,
        204,
      );

      const details = yield* getUser(target.id);

      assert.deepInclude(details, {
        id: target.id,
        subject: "target",
        name: null,
        roles: ["admin", "normalUser"],
        restriction: second,
      });
      assert.deepStrictEqual(second, {
        id: second["id"],
        note: "second",
        restrictedBy: admin.id,
        restrictedAt: second["restrictedAt"],
        liftedAt: null,
        liftedBy: null,
        liftNote: null,
      });
      const restrictions = details["restrictions"] as Array<Json>;
      assert.deepStrictEqual(
        restrictions.map(({ id, note, restrictedBy, liftedBy, liftNote }) => ({
          id,
          note,
          restrictedBy,
          liftedBy,
          liftNote,
        })),
        [
          {
            id: second["id"],
            note: "second",
            restrictedBy: admin.id,
            liftedBy: null,
            liftNote: null,
          },
          {
            id: first["id"],
            note: "first",
            restrictedBy: admin.id,
            liftedBy: root.id,
            liftNote: "appealed",
          },
        ],
      );
      assert.strictEqual(lifted["id"], first["id"]);
      const changes = details["roleChanges"] as Array<Json>;
      assert.deepStrictEqual(
        changes.map(({ role, change, changedBy }) => ({
          role,
          change,
          changedBy,
        })),
        [
          { role: "normalUser", change: "granted", changedBy: null },
          { role: "admin", change: "granted", changedBy: root.id },
        ],
      );
      for (const change of changes) {
        assert.match(String(change["changedAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("answers 404 for an unknown id and 400 for an invalid one", () =>
    Effect.gen(function* () {
      const { call, admin } = yield* setup;
      const missing = yield* call(
        admin.cookie,
        "GET",
        `/admin/users/${unknownId}`,
      );
      assert.strictEqual(missing.status, 404);
      assert.deepStrictEqual(yield* json(missing), {
        _tag: "UserNotFound",
        userId: unknownId,
      });
      const invalid = yield* call(admin.cookie, "GET", "/admin/users/target");
      assert.strictEqual(invalid.status, 400);
    }).pipe(Effect.scoped),
  );
});

describe("admin restrictUser", () => {
  it.effect("restricts with 201 and ends the user's sessions at once", () =>
    Effect.gen(function* () {
      const { request, admin, target, restrict, sessionCount } = yield* setup;
      const second = yield* login(request, "target");
      assert.strictEqual(yield* sessionCount("target"), 2);

      const response = yield* restrict(admin.cookie, target.id, "Spam");

      assert.strictEqual(response.status, 201);
      const body = yield* json(response);
      assert.deepStrictEqual(body, {
        id: body["id"],
        note: "Spam",
        restrictedBy: admin.id,
        restrictedAt: body["restrictedAt"],
        liftedAt: null,
        liftedBy: null,
        liftNote: null,
      });
      assert.strictEqual(yield* sessionCount("target"), 0);
      assert.strictEqual((yield* session(request, target.cookie)).status, 401);
      assert.strictEqual((yield* session(request, second)).status, 401);
      // Nobody else is logged out.
      assert.strictEqual((yield* session(request, admin.cookie)).status, 200);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 409 AlreadyRestricted and keeps the first", () =>
    Effect.gen(function* () {
      const { admin, target, restrict, getUser } = yield* setup;
      yield* restrict(admin.cookie, target.id, "first");
      const response = yield* restrict(admin.cookie, target.id, "second");
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* json(response), {
        _tag: "AlreadyRestricted",
        userId: target.id,
      });
      const details = yield* getUser(target.id);
      assert.deepStrictEqual(
        (details["restrictions"] as Array<Json>).map(({ note }) => note),
        ["first"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("answers 403 RestrictionNotAllowed under the rules", () =>
    Effect.gen(function* () {
      const { root, admin, superAdmin, member, restrict, getUser } =
        yield* setup;
      const other = yield* member("other-admin", "admin");
      const refusals = [
        [admin, admin, "self"],
        [root, root, "self"],
        [admin, other, "privilegedTarget"],
        [admin, superAdmin, "privilegedTarget"],
        [admin, root, "privilegedTarget"],
      ] as const;
      for (const [actor, target, reason] of refusals) {
        const response = yield* restrict(actor.cookie, target.id);
        assert.strictEqual(
          response.status,
          403,
          `${actor.subject} on ${target.subject}`,
        );
        assert.deepStrictEqual(yield* json(response), {
          _tag: "RestrictionNotAllowed",
          reason,
        });
        assert.isNull((yield* getUser(target.id))["restriction"]);
      }
      // admin and superAdmin together may restrict admins.
      assert.strictEqual((yield* restrict(root.cookie, other.id)).status, 201);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 404 for an unknown id", () =>
    Effect.gen(function* () {
      const { admin, restrict } = yield* setup;
      const response = yield* restrict(admin.cookie, unknownId);
      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(yield* json(response), {
        _tag: "UserNotFound",
        userId: unknownId,
      });
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [string, unknown]>([
    ["an empty note", { note: "" }],
    ["an untrimmed note", { note: " Spam " }],
    ["a note over 2000 characters", { note: "x".repeat(2001) }],
    ["no note", {}],
  ])("answers 400 for %s", ([, body]) =>
    Effect.gen(function* () {
      const { call, admin, target, getUser } = yield* setup;
      const response = yield* call(
        admin.cookie,
        "POST",
        `/admin/users/${target.id}/restriction`,
        { body },
      );
      assert.strictEqual(response.status, 400);
      assert.isNull((yield* getUser(target.id))["restriction"]);
    }).pipe(Effect.scoped),
  );
});

describe("admin liftRestriction", () => {
  it.effect("lifts with 200, with or without a note", () =>
    Effect.gen(function* () {
      const { admin, target, restrict, lift } = yield* setup;
      const restricted = yield* json(yield* restrict(admin.cookie, target.id));

      const response = yield* lift(admin.cookie, target.id, "appealed");
      assert.strictEqual(response.status, 200);
      const body = yield* json(response);
      assert.deepInclude(body, {
        id: restricted["id"],
        note: "Spam",
        restrictedBy: admin.id,
        restrictedAt: restricted["restrictedAt"],
        liftedBy: admin.id,
        liftNote: "appealed",
      });
      assert.match(String(body["liftedAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);

      yield* restrict(admin.cookie, target.id);
      const silent = yield* json(yield* lift(admin.cookie, target.id));
      assert.isNull(silent["liftNote"]);
      assert.strictEqual(silent["liftedBy"], admin.id);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 409 NotRestricted without an active restriction", () =>
    Effect.gen(function* () {
      const { admin, target, lift } = yield* setup;
      const response = yield* lift(admin.cookie, target.id);
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* json(response), {
        _tag: "NotRestricted",
        userId: target.id,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("answers 403 RestrictionNotAllowed under the rules", () =>
    Effect.gen(function* () {
      const { root, admin, member, restrict, lift, getUser } = yield* setup;
      const other = yield* member("other-admin", "admin");
      yield* restrict(root.cookie, other.id);

      const self = yield* lift(admin.cookie, admin.id);
      assert.strictEqual(self.status, 403);
      assert.deepStrictEqual(yield* json(self), {
        _tag: "RestrictionNotAllowed",
        reason: "self",
      });
      const privileged = yield* lift(admin.cookie, other.id);
      assert.strictEqual(privileged.status, 403);
      assert.deepStrictEqual(yield* json(privileged), {
        _tag: "RestrictionNotAllowed",
        reason: "privilegedTarget",
      });
      assert.isNotNull((yield* getUser(other.id))["restriction"]);
      assert.strictEqual((yield* lift(root.cookie, other.id)).status, 200);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 404 for an unknown id", () =>
    Effect.gen(function* () {
      const { admin, lift } = yield* setup;
      const response = yield* lift(admin.cookie, unknownId);
      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(yield* json(response), {
        _tag: "UserNotFound",
        userId: unknownId,
      });
    }).pipe(Effect.scoped),
  );
});

describe("admin roles", () => {
  it.effect("a granted role counts from the next request on", () =>
    Effect.gen(function* () {
      const { call, root, target, roleOf, sessionRoles, sql } = yield* setup;
      assert.strictEqual(
        (yield* call(target.cookie, "GET", "/admin/users")).status,
        403,
      );

      const response = yield* roleOf(root.cookie, "PUT", target.id, "admin");

      assert.strictEqual(response.status, 204);
      assert.strictEqual(yield* Effect.promise(() => response.text()), "");
      assert.deepStrictEqual(yield* sessionRoles(target.cookie), [
        "admin",
        "normalUser",
      ]);
      // Same session, no new login.
      assert.strictEqual(
        (yield* call(target.cookie, "GET", "/admin/users")).status,
        200,
      );
      const rows = yield* sql(
        (sql) => sql<{ readonly grantedBy: string | null }>`
          SELECT granted_by FROM user_roles
          WHERE user_id = ${target.id} AND role = 'admin'
        `,
      );
      assert.deepStrictEqual(rows, [{ grantedBy: root.id }]);
    }).pipe(Effect.scoped),
  );

  it.effect("a revoked role is gone from the next request on", () =>
    Effect.gen(function* () {
      const { call, root, admin, roleOf, sessionRoles } = yield* setup;
      const response = yield* roleOf(root.cookie, "DELETE", admin.id, "admin");
      assert.strictEqual(response.status, 204);
      assert.deepStrictEqual(yield* sessionRoles(admin.cookie), ["normalUser"]);
      assert.strictEqual(
        (yield* call(admin.cookie, "GET", "/admin/users")).status,
        403,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("granting and revoking are idempotent", () =>
    Effect.gen(function* () {
      const { root, target, roleOf, getUser } = yield* setup;
      const statuses = [
        (yield* roleOf(root.cookie, "PUT", target.id, "superAdmin")).status,
        (yield* roleOf(root.cookie, "PUT", target.id, "superAdmin")).status,
        (yield* roleOf(root.cookie, "PUT", target.id, "normalUser")).status,
        (yield* roleOf(root.cookie, "DELETE", target.id, "admin")).status,
      ];
      assert.deepStrictEqual(statuses, [204, 204, 204, 204]);
      const details = yield* getUser(target.id);
      assert.deepStrictEqual(details["roles"], ["normalUser", "superAdmin"]);
      // Only the effective change is logged.
      assert.deepStrictEqual(
        (details["roleChanges"] as Array<Json>).map(({ role, change }) => [
          role,
          change,
        ]),
        [
          ["normalUser", "granted"],
          ["superAdmin", "granted"],
        ],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("refuses revoking your own superAdmin with 409", () =>
    Effect.gen(function* () {
      const { root, roleOf, sessionRoles } = yield* setup;
      const response = yield* roleOf(
        root.cookie,
        "DELETE",
        root.id,
        "superAdmin",
      );
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* json(response), {
        _tag: "RoleChangeNotAllowed",
        reason: "ownSuperAdmin",
      });
      assert.deepStrictEqual(yield* sessionRoles(root.cookie), [
        "admin",
        "normalUser",
        "superAdmin",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("answers 404 for an unknown user and 400 for an unknown role", () =>
    Effect.gen(function* () {
      const { root, target, roleOf } = yield* setup;
      for (const method of ["PUT", "DELETE"] as const) {
        const missing = yield* roleOf(root.cookie, method, unknownId, "admin");
        assert.strictEqual(missing.status, 404, method);
        assert.deepStrictEqual(yield* json(missing), {
          _tag: "UserNotFound",
          userId: unknownId,
        });
        const invalid = yield* roleOf(root.cookie, method, target.id, "god");
        assert.strictEqual(invalid.status, 400, method);
      }
    }).pipe(Effect.scoped),
  );
});

describe("restricted users", () => {
  it.effect("a surviving session is refused on the next request", () =>
    Effect.gen(function* () {
      const { request, services, admin, target, restrict, lift, sessionCount } =
        yield* setup;
      /** Stores a session with this cookie, as if it had survived. */
      const addSession = (subject: string, cookie: string) =>
        Effect.flatMap(Sessions, (sessions) =>
          sessions.create({
            idHash: hashSecret(cookie),
            userId: subject,
            providerSessionId: Option.some("kc-session-survivor"),
            claims: {},
            // The app checks expiry against the real clock, not the test's.
            expiresAt: DateTime.makeUnsafe(Date.now() + 60 * 60 * 1000),
          }),
        ).pipe(Effect.orDie, Effect.provide(services));
      yield* restrict(admin.cookie, target.id);
      yield* addSession("target", "survivor");
      // The same kind of session works for a user who isn't restricted.
      yield* addSession("admin", "control");

      assert.strictEqual((yield* session(request, "survivor")).status, 401);
      assert.strictEqual((yield* session(request, "control")).status, 200);
      // Refused by the per-request check, not because the row was deleted.
      assert.strictEqual(yield* sessionCount("target"), 1);

      // Lifting ends it too: the user logs in anew.
      assert.strictEqual((yield* lift(admin.cookie, target.id)).status, 200);
      assert.strictEqual(yield* sessionCount("target"), 0);
      assert.strictEqual((yield* session(request, "survivor")).status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect("a restriction made in SQL refuses existing sessions at once", () =>
    Effect.gen(function* () {
      const { request, sql, target, sessionCount } = yield* setup;
      yield* sql(
        (sql) => sql`
          INSERT INTO user_restrictions (id, user_id, note, restricted_at)
          VALUES (gen_random_uuid(), ${target.id}, 'by an operator', now())
        `,
      );
      assert.strictEqual((yield* session(request, target.cookie)).status, 401);
      assert.strictEqual(yield* sessionCount("target"), 1);
    }).pipe(Effect.scoped),
  );

  it.effect("logins are refused until the restriction is lifted", () =>
    Effect.gen(function* () {
      const { request, sql, admin, target, restrict, lift, sessionCount } =
        yield* setup;
      yield* restrict(admin.cookie, target.id);
      // Marks the stored profile, to see that a refused login changes it not.
      yield* sql(
        (sql) => sql`
          UPDATE users SET
            username = 'before',
            last_login_at = '2026-01-01T00:00:00Z'
          WHERE id = ${target.id}
        `,
      );
      const stored = sql(
        (sql) => sql<{ readonly username: string; readonly lastLoginAt: Date }>`
          SELECT username, last_login_at FROM users WHERE id = ${target.id}
        `,
      );
      const before = yield* stored;

      const refused = yield* loginResponse(request, "target");

      assert.strictEqual(refused.status, 302);
      assert.strictEqual(
        refused.headers.get("location"),
        `${site}/?login_error=restricted`,
      );
      assert.isUndefined(setCookie(refused, "__Host-session"));
      assert.strictEqual(yield* sessionCount("target"), 0);
      assert.deepStrictEqual(yield* stored, before);

      yield* lift(admin.cookie, target.id);
      const accepted = yield* loginResponse(request, "target");
      assert.strictEqual(
        accepted.headers.get("location"),
        `${site}/blog/post?x=1`,
      );
      const cookie = cookieValue(accepted, "__Host-session") ?? "";
      assert.strictEqual((yield* session(request, cookie)).status, 200);
      assert.deepStrictEqual((yield* stored)[0]?.username, "ada");
    }).pipe(Effect.scoped),
  );
});
