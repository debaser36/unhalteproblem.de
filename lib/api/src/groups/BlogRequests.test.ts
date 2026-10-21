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
import type { UserId } from "#domain/Admin";
import type { Role } from "#domain/Auth";
import type {
  AdminBlogRequest,
  BlogRequest,
  BlogRequestId,
} from "#domain/BlogRequest";
import { BlogRequestAlreadyPending } from "#errors/BlogRequestAlreadyPending";
import { BlogRequestNotFound } from "#errors/BlogRequestNotFound";
import { BlogRequestNotPending } from "#errors/BlogRequestNotPending";
import { BlogSlugTaken } from "#errors/BlogSlugTaken";
import { Forbidden } from "#errors/Forbidden";
import { Unauthorized } from "#errors/Unauthorized";
import { UserNotFound } from "#errors/UserNotFound";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";
import { RequireBlogRequestModerator } from "./BlogRequestAdmin.ts";

const requestId = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f" as BlogRequestId;
const decidedId = "6d2e3f40-5b6c-4d7e-8f80-1b2c3d4e5f60" as BlogRequestId;
const missingId = "7e3f4051-6c7d-4e8f-9091-2c3d4e5f6071" as BlogRequestId;
const adaId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60" as UserId;
const t0 = DateTime.makeUnsafe("2026-02-01T10:00:00Z");

const pending: BlogRequest = {
  id: requestId,
  title: "Rust notes",
  description: "Things I learn about Rust.",
  status: "pending",
  createdAt: t0,
  decidedAt: null,
  reason: null,
  blog: null,
};

const adminPending: AdminBlogRequest = {
  ...pending,
  requester: { id: adaId, username: "ada", name: null, deleted: false },
  decidedBy: null,
};

const stateChanging = [
  "blogRequests.requestBlog",
  "blogRequests.withdrawBlogRequest",
  "blogRequestAdmin.approveBlogRequest",
  "blogRequestAdmin.rejectBlogRequest",
];

describe("blog request endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();

  it("exposes the endpoints under their client method names", () => {
    assert.strictEqual(
      operation("/blog-requests", "get")?.operationId,
      "blogRequests.listMyBlogRequests",
    );
    assert.strictEqual(
      operation("/blog-requests", "post")?.operationId,
      "blogRequests.requestBlog",
    );
    assert.strictEqual(
      operation("/blog-requests/{requestId}/withdraw", "post")?.operationId,
      "blogRequests.withdrawBlogRequest",
    );
    assert.strictEqual(
      operation("/admin/blog-requests", "get")?.operationId,
      "blogRequestAdmin.listBlogRequests",
    );
    assert.strictEqual(
      operation("/admin/blog-requests/{requestId}/approve", "post")
        ?.operationId,
      "blogRequestAdmin.approveBlogRequest",
    );
    assert.strictEqual(
      operation("/admin/blog-requests/{requestId}/reject", "post")?.operationId,
      "blogRequestAdmin.rejectBlogRequest",
    );
  });

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/blog-requests", "get"), ["200", "401"]);
    assert.deepStrictEqual(statuses("/blog-requests", "post"), [
      "201",
      "401",
      "403",
      "409",
    ]);
    assert.deepStrictEqual(
      statuses("/blog-requests/{requestId}/withdraw", "post"),
      ["200", "401", "403", "404", "409"],
    );
    assert.deepStrictEqual(statuses("/admin/blog-requests", "get"), [
      "200",
      "401",
      "403",
    ]);
    assert.deepStrictEqual(
      statuses("/admin/blog-requests/{requestId}/approve", "post"),
      ["200", "401", "403", "404", "409"],
    );
    assert.deepStrictEqual(
      statuses("/admin/blog-requests/{requestId}/reject", "post"),
      ["200", "401", "403", "404", "409"],
    );
  });

  it("answers requestBlog with 201 and one BlogRequest component", () => {
    assert.deepStrictEqual(
      operation("/blog-requests", "post")?.responses["201"]?.content?.[
        "application/json"
      ]?.schema,
      {
        anyOf: [{ $ref: "#/components/schemas/BlogRequest" }],
        description: "The new, pending blog request.",
      },
    );
    assert.deepStrictEqual(
      Object.keys(spec.components.schemas).filter((name) => /_\d+$/.test(name)),
      [],
    );
  });

  it("takes the payloads as JSON", () => {
    for (const [path, ref] of [
      ["/blog-requests", "CreateBlogRequestPayload"],
      ["/admin/blog-requests/{requestId}/approve", "ApproveBlogRequestPayload"],
      ["/admin/blog-requests/{requestId}/reject", "RejectBlogRequestPayload"],
    ] as const) {
      assert.deepStrictEqual(
        operation(path, "post")?.requestBody?.content?.["application/json"]
          ?.schema,
        { $ref: `#/components/schemas/${ref}` },
      );
    }
  });

  it("documents status and limit as optional query parameters", () => {
    const parameters =
      operation("/admin/blog-requests", "get")?.parameters ?? [];
    assert.deepStrictEqual(
      parameters.map(({ name, in: location, required }) => ({
        name,
        location,
        required,
      })),
      [
        { name: "status", location: "query", required: false },
        { name: "limit", location: "query", required: false },
      ],
    );
  });

  it("describes that an admin's approval grants the one editor role", () => {
    const description = operation(
      "/admin/blog-requests/{requestId}/approve",
      "post",
    )?.description;
    for (const text of ["grantRole", "blogEditor:<slug>", "BlogSlugTaken"]) {
      assert.include(description, text);
    }
  });

  it("requires the session cookie everywhere", () => {
    for (const [path, method] of [
      ["/blog-requests", "get"],
      ["/blog-requests", "post"],
      ["/blog-requests/{requestId}/withdraw", "post"],
      ["/admin/blog-requests", "get"],
      ["/admin/blog-requests/{requestId}/approve", "post"],
      ["/admin/blog-requests/{requestId}/reject", "post"],
    ] as const) {
      assert.deepStrictEqual(
        operation(path, method)?.security,
        [{ session: [] }],
        `${method} ${path}`,
      );
    }
  });
});

describe("blog request endpoint middleware", () => {
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

  it("puts SameOrigin exactly on the state-changing endpoints", () => {
    const withSameOrigin = [...middlewares]
      .filter(
        ([name, keys]) =>
          /^blogRequest(s|Admin)\./.test(name) && keys.includes(SameOrigin.key),
      )
      .map(([name]) => name)
      .sort();
    assert.deepStrictEqual(withSameOrigin, [...stateChanging].sort());
  });

  it("needs no role for the own requests", () => {
    for (const name of [
      "blogRequests.listMyBlogRequests",
      "blogRequests.requestBlog",
      "blogRequests.withdrawBlogRequest",
    ]) {
      const keys = middlewares.get(name) ?? [];
      assert.isTrue(keys.includes(Authentication.key), name);
      assert.isFalse(
        keys.some((key) => key.includes("RequireRoles")),
        name,
      );
    }
  });

  it("requires admin or superAdmin to moderate", () => {
    assert.strictEqual(
      RequireBlogRequestModerator.key,
      "@unhalteproblem.de/api/RequireRoles(admin,superAdmin)",
    );
    assert.deepStrictEqual(RequireBlogRequestModerator.roles, [
      "admin",
      "superAdmin",
    ]);
    const moderator = [Authentication.key, RequireBlogRequestModerator.key];
    assert.deepStrictEqual(
      middlewares.get("blogRequestAdmin.listBlogRequests"),
      [...moderator].sort(),
    );
    for (const name of [
      "blogRequestAdmin.approveBlogRequest",
      "blogRequestAdmin.rejectBlogRequest",
    ]) {
      assert.deepStrictEqual(
        middlewares.get(name),
        [...moderator, SameOrigin.key].sort(),
        name,
      );
    }
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. The real ones live in the backend.

const site = "https://unhalteproblem.de";

const decided = { ...pending, id: decidedId, status: "withdrawn" } as const;

const BlogRequestsHandlers = HttpApiBuilder.group(
  Api,
  "blogRequests",
  (handlers) =>
    handlers
      .handle("listMyBlogRequests", () => Effect.succeed([pending]))
      .handle("requestBlog", ({ payload }) =>
        payload.title === "Again"
          ? Effect.fail(new BlogRequestAlreadyPending())
          : Effect.succeed({ ...pending, ...payload }),
      )
      .handle("withdrawBlogRequest", ({ params }) =>
        params.requestId === missingId
          ? Effect.fail(new BlogRequestNotFound({ requestId: missingId }))
          : params.requestId === decidedId
            ? Effect.fail(
                new BlogRequestNotPending({
                  requestId: decidedId,
                  status: "withdrawn",
                }),
              )
            : Effect.succeed({
                ...pending,
                status: "withdrawn" as const,
                decidedAt: t0,
              }),
      ),
);

const BlogRequestAdminHandlers = HttpApiBuilder.group(
  Api,
  "blogRequestAdmin",
  (handlers) =>
    handlers
      .handle("listBlogRequests", ({ query }) =>
        Effect.succeed(
          [adminPending, { ...adminPending, status: "rejected" as const }]
            .filter(
              (r) => query.status === undefined || r.status === query.status,
            )
            .slice(0, query.limit),
        ),
      )
      .handle("approveBlogRequest", ({ params, payload }) =>
        params.requestId === missingId
          ? Effect.fail(new BlogRequestNotFound({ requestId: missingId }))
          : params.requestId === decidedId
            ? Effect.fail(
                new BlogRequestNotPending({
                  requestId: decidedId,
                  status: "rejected",
                }),
              )
            : payload.slug === "taken"
              ? Effect.fail(new BlogSlugTaken({ blog: "taken" }))
              : payload.slug === "gone"
                ? Effect.fail(new UserNotFound({ userId: adaId }))
                : Effect.succeed({
                    ...adminPending,
                    status: "approved" as const,
                    decidedAt: t0,
                    blog: payload.slug,
                  }),
      )
      .handle("rejectBlogRequest", ({ params, payload }) =>
        params.requestId === missingId
          ? Effect.fail(new BlogRequestNotFound({ requestId: missingId }))
          : Effect.succeed({
              ...adminPending,
              status: "rejected" as const,
              decidedAt: t0,
              reason: payload.reason ?? null,
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

const asUser = Layer.mergeAll(withSession("normalUser"), withOrigin(site));
const asAdmin = Layer.mergeAll(
  withSession("normalUser,admin"),
  withOrigin(site),
);
const asSuperAdmin = Layer.mergeAll(
  withSession("normalUser,superAdmin"),
  withOrigin(site),
);

const makeClient = HttpApiTest.groups(Api, [
  "blogRequests",
  "blogRequestAdmin",
]);

layer(
  Layer.mergeAll(
    Layer.mergeAll(BlogRequestsHandlers, BlogRequestAdminHandlers).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          requireRolesStub(RequireBlogRequestModerator),
          SameOriginStub,
          // Not used by these groups, but the test server builds every
          // middleware of the API.
          Layer.succeed(RequireAdmin, () => Effect.die("not used")),
          Layer.succeed(RequireSuperAdmin, () => Effect.die("not used")),
          Layer.succeed(LargeBody, () => Effect.die("not used")),
          Layer.succeed(RequireBlogEditor, () => Effect.die("not used")),
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("blog requests client round trip", (it) => {
  it.effect("listMyBlogRequests returns the caller's requests", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.blogRequests.listMyBlogRequests(), [
        pending,
      ]);
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("listMyBlogRequests answers 401 without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.blogRequests
        .listMyBlogRequests()
        .pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }),
  );

  it.effect("requestBlog answers 201 with the pending request", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.blogRequests.requestBlog({
        payload: { title: "Rust notes", description: "Things." },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 201);
      const request = yield* client.blogRequests.requestBlog({
        payload: { title: "Rust notes", description: "Things." },
      });
      assert.strictEqual(request.status, "pending");
      assert.isNull(request.decidedAt);
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("requestBlog fails with BlogRequestAlreadyPending", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.blogRequests.requestBlog({
        payload: { title: "Again", description: "" },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* response.json, {
        _tag: "BlogRequestAlreadyPending",
      });
      const error = yield* client.blogRequests
        .requestBlog({ payload: { title: "Again", description: "" } })
        .pipe(Effect.flip);
      assert.deepStrictEqual(error, new BlogRequestAlreadyPending());
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("requestBlog answers 403 without a same-origin request", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.blogRequests
        .requestBlog({ payload: { title: "t", description: "" } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(withSession("normalUser"))),
  );

  it.effect("withdrawBlogRequest answers with the withdrawn request", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const request = yield* client.blogRequests.withdrawBlogRequest({
        params: { requestId },
      });
      assert.strictEqual(request.status, "withdrawn");
      assert.isTrue(DateTime.isDateTime(request.decidedAt));
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("withdrawBlogRequest fails with NotFound and NotPending", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(
        yield* client.blogRequests
          .withdrawBlogRequest({ params: { requestId: missingId } })
          .pipe(Effect.flip),
        new BlogRequestNotFound({ requestId: missingId }),
      );
      assert.deepStrictEqual(
        yield* client.blogRequests
          .withdrawBlogRequest({ params: { requestId: decidedId } })
          .pipe(Effect.flip),
        new BlogRequestNotPending({
          requestId: decidedId,
          status: decided.status,
        }),
      );
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("listBlogRequests filters by status for admins", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const all = yield* client.blogRequestAdmin.listBlogRequests({
        query: { limit: 50 },
      });
      assert.strictEqual(all.length, 2);
      const onlyPending = yield* client.blogRequestAdmin.listBlogRequests({
        query: { status: "pending", limit: 50 },
      });
      assert.deepStrictEqual(onlyPending, [adminPending]);
      const one = yield* client.blogRequestAdmin.listBlogRequests({
        query: { limit: 1 },
      });
      assert.strictEqual(one.length, 1);
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("superAdmins may moderate without holding admin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const list = yield* client.blogRequestAdmin.listBlogRequests({
        query: { limit: 50 },
      });
      assert.strictEqual(list.length, 2);
    }).pipe(Effect.provide(asSuperAdmin)),
  );

  it.effect("normal users get 403 on the moderation endpoints", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const list = yield* client.blogRequestAdmin
        .listBlogRequests({ query: { limit: 50 } })
        .pipe(Effect.flip);
      assert.instanceOf(list, Forbidden);
      const approve = yield* client.blogRequestAdmin
        .approveBlogRequest({
          params: { requestId },
          payload: { slug: "rust-notes" },
        })
        .pipe(Effect.flip);
      assert.instanceOf(approve, Forbidden);
    }).pipe(Effect.provide(asUser)),
  );

  it.effect("approveBlogRequest answers with the created blog's slug", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const request = yield* client.blogRequestAdmin.approveBlogRequest({
        params: { requestId },
        payload: { slug: "rust-notes" },
      });
      assert.strictEqual(request.status, "approved");
      assert.strictEqual(request.blog, "rust-notes");
      assert.strictEqual(request.requester.id, adaId);
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("approveBlogRequest fails with its four errors", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const fail = (id: BlogRequestId, slug: string) =>
        client.blogRequestAdmin
          .approveBlogRequest({ params: { requestId: id }, payload: { slug } })
          .pipe(Effect.flip);
      assert.instanceOf(yield* fail(missingId, "a"), BlogRequestNotFound);
      assert.instanceOf(yield* fail(decidedId, "a"), BlogRequestNotPending);
      assert.instanceOf(yield* fail(requestId, "taken"), BlogSlugTaken);
      assert.instanceOf(yield* fail(requestId, "gone"), UserNotFound);
    }).pipe(Effect.provide(asAdmin)),
  );

  it.effect("rejectBlogRequest takes an optional reason", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const withReason = yield* client.blogRequestAdmin.rejectBlogRequest({
        params: { requestId },
        payload: { reason: "Too similar." },
      });
      assert.strictEqual(withReason.status, "rejected");
      assert.strictEqual(withReason.reason, "Too similar.");
      const without = yield* client.blogRequestAdmin.rejectBlogRequest({
        params: { requestId },
        payload: {},
      });
      assert.isNull(without.reason);
      const error = yield* client.blogRequestAdmin
        .rejectBlogRequest({ params: { requestId: missingId }, payload: {} })
        .pipe(Effect.flip);
      assert.instanceOf(error, BlogRequestNotFound);
    }).pipe(Effect.provide(asSuperAdmin)),
  );
});
