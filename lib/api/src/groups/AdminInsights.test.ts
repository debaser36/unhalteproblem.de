// The admin insights group: its OpenAPI document, middlewares, and an
// encoding round trip through the in-memory client.
import { assert, describe, it, layer } from "@effect/vitest";
import { Array as Arr, DateTime, Effect, Layer, Redacted } from "effect";
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
import { RequireBlogEditor, type RequireRoles } from "#Authorization";
import { UserId } from "#domain/Admin";
import { type AuditLogEntry, AuditLogEntryId } from "#domain/Audit";
import type { Role } from "#domain/Auth";
import {
  ContactMessageId,
  type ReceivedContactMessage,
} from "#domain/ContactMessage";
import type { DatabaseOverview } from "#domain/Database";
import { type OutboxMessage, OutboxMessageId } from "#domain/Outbox";
import { ContactMessageNotFound } from "#errors/ContactMessageNotFound";
import { Forbidden } from "#errors/Forbidden";
import { OutboxMessageNotFound } from "#errors/OutboxMessageNotFound";
import { Unauthorized } from "#errors/Unauthorized";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";
import { RequireBlogRequestModerator } from "./BlogRequestAdmin.ts";
import { RequireFoodPlanner } from "./Food.ts";

describe("admin insights endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "delete";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();
  const endpoints: ReadonlyArray<readonly [string, Method]> = [
    ["/admin/database", "get"],
    ["/admin/outbox", "get"],
    ["/admin/outbox/{messageId}/retry", "post"],
    ["/admin/audit", "get"],
    ["/admin/contact", "get"],
    ["/admin/contact/{messageId}", "delete"],
    ["/admin/insights/payments", "get"],
  ];

  it("documents the response statuses", () => {
    const reads = ["200", "401", "403"];
    assert.deepStrictEqual(statuses("/admin/database", "get"), reads);
    assert.deepStrictEqual(statuses("/admin/outbox", "get"), reads);
    assert.deepStrictEqual(statuses("/admin/audit", "get"), reads);
    assert.deepStrictEqual(statuses("/admin/contact", "get"), reads);
    assert.deepStrictEqual(statuses("/admin/insights/payments", "get"), reads);
    const writes = ["204", "401", "403", "404"];
    assert.deepStrictEqual(
      statuses("/admin/outbox/{messageId}/retry", "post"),
      writes,
    );
    assert.deepStrictEqual(
      statuses("/admin/contact/{messageId}", "delete"),
      writes,
    );
  });

  it("puts every endpoint behind the session", () => {
    for (const [path, method] of endpoints) {
      assert.deepStrictEqual(
        operation(path, method)?.security,
        [{ session: [] }],
        path,
      );
    }
  });

  it("documents the query parameters as optional", () => {
    const parameters = (path: string) =>
      (operation(path, "get")?.parameters ?? []).map((p) => [
        p.name,
        p.required,
      ]);
    assert.deepStrictEqual(parameters("/admin/outbox"), [
      ["state", false],
      ["limit", false],
    ]);
    assert.deepStrictEqual(parameters("/admin/audit"), [
      ["limit", false],
      ["cursor", false],
      ["action", false],
      ["userId", false],
    ]);
    assert.deepStrictEqual(parameters("/admin/contact"), [
      ["limit", false],
      ["cursor", false],
    ]);
  });

  it("documents the audit actions and integer ids", () => {
    const schemas = spec.components.schemas;
    assert.deepStrictEqual(
      (schemas["AuditAction"] as { enum?: unknown }).enum,
      [
        "login",
        "logout",
        "login_refused",
        "role_granted",
        "role_revoked",
        "user_restricted",
        "restriction_lifted",
        "account_deleted",
        "outbox_retried",
        "contact_message_deleted",
        "blog_created",
        "blog_updated",
        "post_deleted",
        "project_created",
        "project_updated",
        "project_deleted",
        "blog_request_approved",
        "blog_request_rejected",
        "category_created",
        "category_renamed",
        "category_merged",
        "category_deleted",
        "payment_refunded",
        "payment_product_updated",
        "payment_product_roles_changed",
        "payment_catalog_synced",
      ],
    );
    for (const name of ["AuditLogEntryId", "OutboxMessageId"]) {
      const schema = schemas[name] as { type?: string; minimum?: number };
      assert.strictEqual(schema.type, "integer", name);
      assert.strictEqual(schema.minimum, 1, name);
    }
    assert.isFalse(Object.keys(schemas).some((name) => /_\d+$/.test(name)));
  });
});

describe("admin insights endpoint middleware", () => {
  const middlewares = new Map<string, Array<string>>();
  HttpApi.reflect(Api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware }) => {
      if (group.identifier !== "adminInsights") return;
      middlewares.set(
        endpoint.identifier,
        [...middleware].map((m) => m.key).sort(),
      );
    },
  });

  it("requires a session and admin everywhere and the origin on writes", () => {
    const writes = ["retryOutboxMessage", "deleteContactMessage"];
    assert.deepStrictEqual([...middlewares.keys()].sort(), [
      "databaseOverview",
      "deleteContactMessage",
      "listAuditLog",
      "listContactMessages",
      "listOutbox",
      "paymentInsights",
      "retryOutboxMessage",
    ]);
    for (const [name, keys] of middlewares) {
      assert.isTrue(keys.includes(Authentication.key), name);
      assert.isTrue(keys.includes(RequireAdmin.key), name);
      assert.isFalse(keys.includes(RequireSuperAdmin.key), name);
      assert.strictEqual(
        keys.includes(SameOrigin.key),
        writes.includes(name),
        name,
      );
    }
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. Real implementations live in the
// backend.

const t0 = DateTime.makeUnsafe("2026-03-01T12:00:00Z");
const site = "https://unhalteproblem.de";
const adaId = UserId.make("3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60");
const outboxId = OutboxMessageId.make(7);
const messageId = ContactMessageId.make("6a1f3c2e-8b4d-4e5f-9a6b-7c8d9e0f1a2b");

const overview: DatabaseOverview = {
  postgresVersion: "17.5",
  databaseName: "unhalteproblem",
  databaseBytes: 8_000_000_000,
  startedAt: t0,
  connections: { active: 1, idle: 4, total: 5, max: 100 },
  cacheHitRatio: null,
  tables: [
    {
      name: "users",
      estimatedRows: 12,
      totalBytes: 98304,
      tableBytes: 16384,
      indexBytes: 81920,
      sequentialScans: 3,
      indexScans: null,
      lastVacuum: null,
      lastAutovacuum: t0,
      lastAnalyze: null,
      lastAutoanalyze: t0,
    },
  ],
  migrations: [{ id: 1, name: "create_auth_tables", appliedAt: t0 }],
};

const deadMessage: OutboxMessage = {
  id: outboxId,
  topic: "contact.send-mail",
  attempts: 10,
  lastError: "MailFailed:EAUTH:535:AUTH PLAIN",
  availableAt: t0,
  lockedUntil: null,
  deadAt: t0,
  createdAt: t0,
};

const auditEntry = (id: number): AuditLogEntry => ({
  id: AuditLogEntryId.make(id),
  at: t0,
  action: "outbox_retried",
  actorId: adaId,
  targetId: null,
  detail: "contact.send-mail",
});

const received: ReceivedContactMessage = {
  id: messageId,
  name: "Ada Lovelace",
  email: "ada@example.org",
  message: "Hello there!",
  createdAt: t0,
};

const AdminInsightsHandlers = HttpApiBuilder.group(
  Api,
  "adminInsights",
  (handlers) =>
    handlers
      .handle("paymentInsights", () =>
        Effect.succeed({
          revenueLast30Days: [{ amount: 1999, currency: "eur" }],
          revenueTotal: [{ amount: 5000, currency: "eur" }],
          refundedTotal: [],
          monthlyRecurringRevenue: [{ amount: 500, currency: "eur" }],
          activeSubscriptions: 1,
          livemode: false,
        }),
      )
      .handle("databaseOverview", () => Effect.succeed(overview))
      // Echoes the decoded query in the topic, to check the defaults.
      .handle("listOutbox", ({ query }) =>
        Effect.succeed([
          { ...deadMessage, topic: `${query.state}:${query.limit}` },
        ]),
      )
      .handle("retryOutboxMessage", ({ params }) =>
        params.messageId === outboxId
          ? Effect.void
          : Effect.fail(
              new OutboxMessageNotFound({ messageId: params.messageId }),
            ),
      )
      // Two entries per page below the cursor (or from 50), down to 1.
      .handle("listAuditLog", ({ query }) => {
        const from = (query.cursor?.id ?? 51) - 1;
        const ids = [from, from - 1].filter((id) => id >= 1);
        const last = ids.at(-1);
        return Effect.succeed({
          entries: ids.map(auditEntry),
          nextCursor:
            last === undefined || last === 1
              ? null
              : { id: AuditLogEntryId.make(last) },
        });
      })
      .handle("listContactMessages", ({ query }) =>
        Effect.succeed({
          messages: query.cursor === undefined ? [received] : [],
          nextCursor:
            query.cursor === undefined
              ? { createdAt: received.createdAt, id: received.id }
              : null,
        }),
      )
      .handle("deleteContactMessage", ({ params }) =>
        params.messageId === messageId
          ? Effect.void
          : Effect.fail(
              new ContactMessageNotFound({ messageId: params.messageId }),
            ),
      ),
);

// Session ids are the user's roles, comma-separated (see `Admin.test.ts`).
const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) => {
    const value = Redacted.value(credential);
    return value === ""
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(httpEffect, CurrentUser, {
          user: { id: "session-user", roles: value.split(",") as Array<Role> },
          expiresAt: t0,
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

const as = (roles: string, origin = site) =>
  Layer.mergeAll(
    HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
      next(
        HttpClientRequest.setHeader(
          request,
          "cookie",
          `${SessionCookie}=${roles}`,
        ),
      ),
    ),
    HttpApiMiddleware.layerClient(SameOrigin, ({ next, request }) =>
      next(HttpClientRequest.setHeader(request, "origin", origin)),
    ),
  );

const makeClient = HttpApiTest.groups(Api, ["adminInsights"]);

layer(
  Layer.mergeAll(
    AdminInsightsHandlers.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          requireRolesStub(RequireAdmin),
          // Not used by this group, but the test server builds every
          // middleware of the API.
          requireRolesStub(RequireSuperAdmin),
          Layer.succeed(RequireFoodPlanner, () =>
            Effect.die("not used by this group"),
          ),
          Layer.succeed(RequireBlogRequestModerator, () =>
            Effect.die("not used by this group"),
          ),
          Layer.succeed(RequireBlogEditor, (httpEffect) => httpEffect),
          SameOriginStub,
          Layer.succeed(LargeBody, (httpEffect) => httpEffect),
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("admin insights client round trip", (it) => {
  it.effect("databaseOverview returns the overview", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(
        yield* client.adminInsights.databaseOverview(),
        overview,
      );
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect(
    "listOutbox passes the query, and the client refuses an invalid one",
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const [message] = yield* client.adminInsights.listOutbox({
          query: { state: "dead", limit: 200 },
        });
        assert.strictEqual(message?.topic, "dead:200");
        assert.strictEqual(message?.id, outboxId);
        // The defaults are covered in `domain/Outbox.test.ts`; the client
        // encodes the query, so it never sends a limit out of bounds.
        const error = yield* client.adminInsights
          .listOutbox({ query: { state: "all", limit: 201 } })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "SchemaError");
      }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("retryOutboxMessage answers 204, or 404 for an unknown id", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.adminInsights.retryOutboxMessage({
        params: { messageId: outboxId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 204);
      assert.strictEqual(yield* response.text, "");
      const unknown = OutboxMessageId.make(8);
      assert.deepStrictEqual(
        yield* client.adminInsights
          .retryOutboxMessage({ params: { messageId: unknown } })
          .pipe(Effect.flip),
        new OutboxMessageNotFound({ messageId: unknown }),
      );
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("listAuditLog pages by the cursor it returns", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const first = yield* client.adminInsights.listAuditLog({
        query: { limit: 2, action: "outbox_retried", userId: adaId },
      });
      assert.deepStrictEqual(
        first.entries.map((entry) => entry.id),
        [50, 49],
      );
      assert.deepStrictEqual(first.nextCursor, {
        id: AuditLogEntryId.make(49),
      });
      const second = yield* client.adminInsights.listAuditLog({
        query: {
          limit: 2,
          ...(first.nextCursor && { cursor: first.nextCursor }),
        },
      });
      assert.deepStrictEqual(
        second.entries.map((entry) => entry.id),
        [48, 47],
      );
      assert.deepStrictEqual(second.entries[0], auditEntry(48));
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("listContactMessages returns a page and its cursor", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const first = yield* client.adminInsights.listContactMessages({
        query: { limit: 50 },
      });
      assert.deepStrictEqual(first.messages, [received]);
      assert.isNotNull(first.nextCursor);
      if (first.nextCursor === null) return;
      const second = yield* client.adminInsights.listContactMessages({
        query: { limit: 50, cursor: first.nextCursor },
      });
      assert.deepStrictEqual(second, { messages: [], nextCursor: null });
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("deleteContactMessage answers 204, or 404 for an unknown id", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.adminInsights.deleteContactMessage({
        params: { messageId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 204);
      const unknown = ContactMessageId.make(
        "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
      );
      assert.deepStrictEqual(
        yield* client.adminInsights
          .deleteContactMessage({ params: { messageId: unknown } })
          .pipe(Effect.flip),
        new ContactMessageNotFound({ messageId: unknown }),
      );
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("every endpoint answers 401 without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.instanceOf(
        yield* client.adminInsights.databaseOverview().pipe(Effect.flip),
        Unauthorized,
      );
    }),
  );

  it.effect("every endpoint answers 403 without admin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.instanceOf(
        yield* client.adminInsights
          .listContactMessages({ query: { limit: 50 } })
          .pipe(Effect.flip),
        Forbidden,
      );
      assert.instanceOf(
        yield* client.adminInsights
          .retryOutboxMessage({ params: { messageId: outboxId } })
          .pipe(Effect.flip),
        Forbidden,
      );
    }).pipe(Effect.provide(as("normalUser,superAdmin"))),
  );

  it.effect("writes answer 403 for a foreign origin, even for admins", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.instanceOf(
        yield* client.adminInsights
          .deleteContactMessage({ params: { messageId } })
          .pipe(Effect.flip),
        Forbidden,
      );
      // Reads need no origin.
      assert.deepStrictEqual(
        yield* client.adminInsights.databaseOverview(),
        overview,
      );
    }).pipe(Effect.provide(as("admin", "https://evil.example"))),
  );
});
