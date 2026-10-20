// The projects and project admin groups: their OpenAPI document,
// middlewares, and an encoding round trip through the in-memory client.
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
import type { RequireRoles } from "#Authorization";
import type { Role } from "#domain/Auth";
import { emptyDocument } from "#domain/Document";
import {
  type ManagedProject,
  ProjectId,
  type ProjectInput,
  type PublishedProject,
} from "#domain/Project";
import { Forbidden } from "#errors/Forbidden";
import { ProjectEditConflict } from "#errors/ProjectEditConflict";
import { ProjectNotFound } from "#errors/ProjectNotFound";
import { Unauthorized } from "#errors/Unauthorized";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";

describe("project endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "put" | "delete";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();
  const projects = "/admin/projects";
  const project = "/admin/projects/{projectId}";
  const media = "/admin/projects/media";

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/projects", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/projects/{project}", "get"), [
      "200",
      "404",
    ]);
    assert.deepStrictEqual(statuses(projects, "get"), ["200", "401", "403"]);
    assert.deepStrictEqual(statuses(projects, "post"), [
      "201",
      "401",
      "403",
      "409",
    ]);
    assert.deepStrictEqual(statuses(project, "get"), [
      "200",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(statuses(project, "put"), [
      "200",
      "401",
      "403",
      "404",
      "409",
    ]);
    assert.deepStrictEqual(statuses(project, "delete"), [
      "204",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(statuses(media, "post"), [
      "201",
      "400",
      "401",
      "403",
      "413",
      "415",
    ]);
  });

  it("keeps the projects public and the admin endpoints behind the session", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      const admin = path.startsWith("/admin/projects");
      if (!admin && !path.startsWith("/projects")) continue;
      for (const op of Object.values(item ?? {})) {
        assert.deepStrictEqual(
          (op as { security?: unknown }).security,
          admin ? [{ session: [] }] : [],
          path,
        );
      }
    }
  });

  it("returns one ManagedProject and one MediaInfo component", () => {
    const json = (path: string, method: Method, status: number) =>
      operation(path, method)?.responses[status]?.content?.["application/json"]
        ?.schema;
    assert.deepStrictEqual(json(projects, "post", 201), {
      anyOf: [{ $ref: "#/components/schemas/ManagedProject" }],
      description: "The new project.",
    });
    assert.deepStrictEqual(json(project, "put", 200), {
      $ref: "#/components/schemas/ManagedProject",
    });
    assert.deepStrictEqual(
      (json(media, "post", 201) as { anyOf?: unknown }).anyOf,
      [{ $ref: "#/components/schemas/MediaInfo" }],
    );
    assert.isFalse(
      Object.keys(spec.components.schemas).some((name) => /_\d+$/.test(name)),
    );
  });

  it("documents the links as nullable HttpUrls", () => {
    const item = spec.components.schemas["ProjectListItem"] as {
      readonly properties: Record<string, unknown>;
    };
    for (const field of ["repoUrl", "liveUrl"]) {
      assert.deepStrictEqual(
        item.properties[field],
        {
          anyOf: [{ $ref: "#/components/schemas/HttpUrl" }, { type: "null" }],
        },
        field,
      );
    }
    const httpUrl = spec.components.schemas["HttpUrl"] as {
      readonly maxLength?: number;
    };
    assert.strictEqual(httpUrl.maxLength, 2048);
  });

  it("takes the upload as multipart", () => {
    assert.deepStrictEqual(
      Object.keys(operation(media, "post")?.requestBody?.content ?? {}),
      ["multipart/form-data"],
    );
  });
});

describe("project endpoint middleware", () => {
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
  const inGroup = (prefix: string) =>
    [...middlewares].filter(([name]) => name.startsWith(prefix));

  it("needs no middleware on the public group", () => {
    const endpoints = inGroup("projects.");
    assert.lengthOf(endpoints, 2);
    for (const [name, keys] of endpoints) {
      assert.deepStrictEqual(keys, [], name);
    }
  });

  it("requires a session and admin everywhere, the origin on writes and a large body for whole projects", () => {
    const writes = [
      "projectAdmin.createProject",
      "projectAdmin.updateProject",
      "projectAdmin.deleteProject",
      "projectAdmin.uploadProjectMedia",
    ];
    const large = ["projectAdmin.createProject", "projectAdmin.updateProject"];
    const endpoints = inGroup("projectAdmin.");
    assert.lengthOf(endpoints, 6);
    for (const [name, keys] of endpoints) {
      assert.isTrue(keys.includes(Authentication.key), name);
      assert.isTrue(keys.includes(RequireAdmin.key), name);
      assert.isFalse(keys.includes(RequireSuperAdmin.key), name);
      assert.strictEqual(
        keys.includes(SameOrigin.key),
        writes.includes(name),
        name,
      );
      assert.strictEqual(
        keys.includes(LargeBody.key),
        large.includes(name),
        name,
      );
    }
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. Real implementations live in the
// backend.

const projectId = ProjectId.make("5b1c0e7a-9d3f-4a2b-8c6d-7e8f9a0b1c2d");
const t0 = DateTime.makeUnsafe("2026-03-01T12:00:00Z");
const site = "https://unhalteproblem.de";

const publishedProject: PublishedProject = {
  id: projectId,
  slug: "type-checker",
  title: "Type checker",
  summary: "A small type checker.",
  tags: ["rust"],
  status: "active",
  featured: true,
  repoUrl: "https://github.com/ada/type-checker",
  liveUrl: null,
  coverImage: null,
  updatedAt: t0,
  content: emptyDocument,
};

const managed = (input: ProjectInput, version: number): ManagedProject => ({
  ...input,
  id: projectId,
  createdAt: t0,
  updatedAt: t0,
  version,
});

const ProjectsHandlers = HttpApiBuilder.group(Api, "projects", (handlers) =>
  handlers
    .handle("listProjects", () => Effect.succeed([publishedProject]))
    .handle("getProject", ({ params }) =>
      params.project === publishedProject.slug
        ? Effect.succeed(publishedProject)
        : Effect.fail(new ProjectNotFound({ project: params.project })),
    ),
);

const ProjectAdminHandlers = HttpApiBuilder.group(
  Api,
  "projectAdmin",
  (handlers) =>
    handlers
      .handle("listManagedProjects", () => Effect.succeed([]))
      .handle("getManagedProject", ({ params }) =>
        Effect.fail(new ProjectNotFound({ project: params.projectId })),
      )
      .handle("createProject", ({ payload }) =>
        Effect.succeed(managed(payload, 1)),
      )
      .handle("updateProject", ({ payload: { version, ...input } }) =>
        version === 2
          ? Effect.succeed(managed(input, 3))
          : Effect.fail(new ProjectEditConflict({ currentVersion: 2 })),
      )
      .handle("deleteProject", () => Effect.void)
      .handle("uploadProjectMedia", () => Effect.die("not used")),
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

const makeClient = HttpApiTest.groups(Api, ["projects", "projectAdmin"]);

const input: ProjectInput = {
  slug: "type-checker",
  title: "Type checker",
  summary: "",
  tags: [],
  status: "active",
  featured: false,
  position: 10,
  repoUrl: null,
  liveUrl: "https://types.example/",
  coverImage: null,
  content: emptyDocument,
  published: true,
};

layer(
  Layer.mergeAll(
    Layer.mergeAll(ProjectsHandlers, ProjectAdminHandlers).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          requireRolesStub(RequireAdmin),
          requireRolesStub(RequireSuperAdmin),
          SameOriginStub,
          // Pass-through: the stub checks nothing.
          Layer.succeed(LargeBody, (httpEffect) => httpEffect),
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("project client round trip", (it) => {
  it.effect("listProjects and getProject return published projects", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { content: _, ...listItem } = publishedProject;
      assert.deepStrictEqual(yield* client.projects.listProjects(), [listItem]);
      assert.deepStrictEqual(
        yield* client.projects.getProject({
          params: { project: "type-checker" },
        }),
        publishedProject,
      );
      const response = yield* client.projects.getProject({
        params: { project: "missing" },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(
        yield* client.projects
          .getProject({ params: { project: "missing" } })
          .pipe(Effect.flip),
        new ProjectNotFound({ project: "missing" }),
      );
    }),
  );

  it.effect("createProject answers 201 with the project", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.projectAdmin.createProject({
        payload: input,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 201);
      assert.deepStrictEqual(
        yield* client.projectAdmin.createProject({ payload: input }),
        managed(input, 1),
      );
    }).pipe(Effect.provide(as("normalUser,admin"))),
  );

  it.effect("updateProject saves or answers 409 with the current version", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const params = { projectId };
      assert.strictEqual(
        (yield* client.projectAdmin.updateProject({
          params,
          payload: { ...input, version: 2 },
        })).version,
        3,
      );
      const response = yield* client.projectAdmin.updateProject({
        params,
        payload: { ...input, version: 1 },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(
        yield* client.projectAdmin
          .updateProject({ params, payload: { ...input, version: 1 } })
          .pipe(Effect.flip),
        new ProjectEditConflict({ currentVersion: 2 }),
      );
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("deleteProject answers 204 without a body", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.projectAdmin.deleteProject({
        params: { projectId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 204);
      assert.strictEqual(yield* response.text, "");
    }).pipe(Effect.provide(as("admin"))),
  );

  it.effect("the admin endpoints answer 401 without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.projectAdmin
        .listManagedProjects()
        .pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }),
  );

  it.effect("the admin endpoints answer 403 without admin", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.instanceOf(
        yield* client.projectAdmin.listManagedProjects().pipe(Effect.flip),
        Forbidden,
      );
      assert.instanceOf(
        yield* client.projectAdmin
          .createProject({ payload: input })
          .pipe(Effect.flip),
        Forbidden,
      );
    }).pipe(Effect.provide(as("normalUser,blogEditor:rust-notes"))),
  );

  it.effect("writes answer 403 for a foreign origin, even for admins", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.projectAdmin.deleteProject({
        params: { projectId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 403);
      // Reads need no origin.
      assert.deepStrictEqual(
        yield* client.projectAdmin.listManagedProjects(),
        [],
      );
    }).pipe(Effect.provide(as("admin", "https://evil.example"))),
  );
});
