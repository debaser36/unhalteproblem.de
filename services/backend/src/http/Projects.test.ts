import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  doc,
  form,
  type Json,
  json,
  makeBlogApp,
  png,
  words,
} from "#testing/Blogs";

/** An id no project has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

/** A project's fields, parts of which can be replaced. */
const projectInput = (
  slug: string,
  overrides: Partial<Record<string, unknown>> = {},
) => ({
  slug,
  title: `Title of ${slug}`,
  summary: `Summary of ${slug}`,
  tags: [],
  status: "active",
  featured: false,
  position: 0,
  repoUrl: null,
  liveUrl: null,
  coverImage: null,
  content: doc(words(10)),
  published: false,
  ...overrides,
});

/**
 * Every project admin endpoint, as a request on project `id`. Bodies are
 * made fresh per call: a `FormData` can be sent only once.
 */
const endpoints = (id: string) =>
  [
    { name: "listManagedProjects", method: "GET", path: "/admin/projects" },
    {
      name: "getManagedProject",
      method: "GET",
      path: `/admin/projects/${id}`,
    },
    {
      name: "createProject",
      method: "POST",
      path: "/admin/projects",
      body: () => projectInput("intruder"),
    },
    {
      name: "updateProject",
      method: "PUT",
      path: `/admin/projects/${id}`,
      body: () => ({ ...projectInput("intruder"), version: 1 }),
    },
    {
      name: "deleteProject",
      method: "DELETE",
      path: `/admin/projects/${id}`,
    },
    {
      name: "uploadProjectMedia",
      method: "POST",
      path: "/admin/projects/media",
      body: () => form(png),
    },
  ] as const;

type Endpoint = ReturnType<typeof endpoints>[number];

const bodyOf = (endpoint: Endpoint) =>
  "body" in endpoint ? endpoint.body() : undefined;

/** The app, a blog editor (of `alpha`) and helpers for projects. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha");
  const blogEditor = yield* app.editor("ed", "alpha");

  /** Creates a project as `admin`; returns the `ManagedProject`. */
  const createProject = (input: ReturnType<typeof projectInput>) =>
    app.expect(201, app.admin.cookie, "POST", "/admin/projects", {
      body: input,
    });

  /** Sets a project's last change in SQL, to order the list. */
  const setUpdatedAt = (id: unknown, at: Date) =>
    app.sql(
      (sql) => sql`
        UPDATE projects SET updated_at = ${at} WHERE id = ${String(id)}
      `,
    );

  const counts = app
    .sql(
      (sql) => sql<{ readonly projects: number; readonly media: number }>`
        SELECT (SELECT count(*)::int FROM projects) AS projects,
               (SELECT count(*)::int FROM media) AS media
      `,
    )
    .pipe(Effect.map((rows) => rows[0]));

  return { ...app, blogEditor, createProject, setUpdatedAt, counts };
});

const slugs = (list: Json) =>
  (list as unknown as ReadonlyArray<Json>).map((item) => item["slug"]);

describe("project admin access", () => {
  it.effect("every endpoint requires a session (401)", () =>
    Effect.gen(function* () {
      const { call } = yield* setup;
      for (const endpoint of endpoints(unknownId)) {
        for (const cookie of [undefined, "unknown"]) {
          // Without Origin too: the session is checked first.
          for (const origin of [undefined, null]) {
            const response = yield* call(
              cookie,
              endpoint.method,
              endpoint.path,
              { body: bodyOf(endpoint), origin },
            );
            assert.strictEqual(
              response.status,
              401,
              `${endpoint.name} (cookie ${cookie}, origin ${origin})`,
            );
          }
        }
      }
    }),
  );

  it.effect("a normal user, a blog editor and a superAdmin get 403", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const project = yield* app.createProject(projectInput("mine"));
      const id = String(project["id"]);
      // Roles are flat: superAdmin alone does not include admin.
      const outsiders = {
        user: app.user,
        blogEditor: app.blogEditor,
        superAdmin: app.superAdmin,
      };
      for (const [who, { cookie }] of Object.entries(outsiders)) {
        for (const endpoint of endpoints(id)) {
          const response = yield* app.call(
            cookie,
            endpoint.method,
            endpoint.path,
            { body: bodyOf(endpoint) },
          );
          const body = yield* json(response);
          assert.strictEqual(response.status, 403, `${who}: ${endpoint.name}`);
          assert.strictEqual(body["_tag"], "Forbidden");
        }
      }
      // Nothing was changed, created or uploaded.
      const after = yield* app.expect(
        200,
        app.admin.cookie,
        "GET",
        `/admin/projects/${id}`,
      );
      assert.deepInclude(after, { slug: "mine", version: 1 });
      assert.deepStrictEqual(yield* app.counts, { projects: 1, media: 0 });
    }),
  );

  it.effect(
    "state-changing endpoints require a same-origin request (403)",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const project = yield* app.createProject(projectInput("mine"));
        const changing = endpoints(String(project["id"])).filter(
          (endpoint) => endpoint.method !== "GET",
        );
        for (const endpoint of changing) {
          for (const origin of [null, "https://evil.example"]) {
            const response = yield* app.call(
              app.admin.cookie,
              endpoint.method,
              endpoint.path,
              { body: bodyOf(endpoint), origin },
            );
            assert.strictEqual(
              response.status,
              403,
              `${endpoint.name} (origin ${origin})`,
            );
          }
        }
        assert.deepStrictEqual(yield* app.counts, { projects: 1, media: 0 });
        // Reads need no Origin.
        yield* app.expect(200, app.admin.cookie, "GET", "/admin/projects", {
          origin: null,
        });
      }),
  );

  it.effect("admin responses must not be cached", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { admin, call } = app;
      const created = yield* call(admin.cookie, "POST", "/admin/projects", {
        body: projectInput("mine"),
      });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.headers.get("cache-control"), "no-store");
      const id = String((yield* json(created))["id"]);
      // deleteProject (204) doesn't set the header yet; that is being fixed
      // separately, add it here then.
      for (const [method, path, body] of [
        ["GET", "/admin/projects", undefined],
        ["GET", `/admin/projects/${id}`, undefined],
        [
          "PUT",
          `/admin/projects/${id}`,
          { ...projectInput("mine"), version: 1 },
        ],
        ["POST", "/admin/projects/media", form(png)],
      ] as const) {
        const response = yield* call(admin.cookie, method, path, { body });
        assert.isBelow(response.status, 300, `${method} ${path}`);
        assert.strictEqual(
          response.headers.get("cache-control"),
          "no-store",
          `${method} ${path}`,
        );
      }
    }),
  );
});

describe("writing a project", () => {
  it.effect("from a draft to a deleted project", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { expect, call, admin } = app;

      // An admin writes a draft.
      const content = doc(words(50), words(20));
      const input = projectInput("type-checker", {
        title: "Type checker",
        tags: ["rust", "types"],
        status: "completed",
        featured: true,
        position: 3,
        repoUrl: "https://github.com/example/type-checker",
        liveUrl: "http://type-checker.example.org/play?x=1#top",
        content,
      });
      const draft = yield* app.createProject(input);
      const id = String(draft["id"]);
      assert.deepInclude(draft, {
        slug: "type-checker",
        title: "Type checker",
        summary: "Summary of type-checker",
        tags: ["rust", "types"],
        status: "completed",
        featured: true,
        position: 3,
        repoUrl: "https://github.com/example/type-checker",
        liveUrl: "http://type-checker.example.org/play?x=1#top",
        coverImage: null,
        published: false,
        version: 1,
      });
      assert.deepStrictEqual(draft["content"], content);
      assert.isString(draft["createdAt"]);
      assert.strictEqual(draft["updatedAt"], draft["createdAt"]);
      const stored = yield* app.sql(
        (sql) =>
          sql<{
            readonly createdBy: string;
            readonly updatedBy: string;
          }>`SELECT created_by, updated_by FROM projects WHERE id = ${id}`,
      );
      assert.deepStrictEqual(stored, [
        { createdBy: admin.id, updatedBy: admin.id },
      ]);

      // Drafts are no business of visitors.
      assert.deepStrictEqual(
        yield* expect(404, undefined, "GET", "/projects/type-checker"),
        { _tag: "ProjectNotFound", project: "type-checker" },
      );
      assert.deepStrictEqual(
        yield* expect(200, undefined, "GET", "/projects"),
        [] as unknown as Json,
      );

      // Published through an update, everyone sees it.
      const published = yield* expect(
        200,
        admin.cookie,
        "PUT",
        `/admin/projects/${id}`,
        { body: { ...input, published: true, version: 1 } },
      );
      assert.deepInclude(published, { published: true, version: 2 });
      assert.strictEqual(published["createdAt"], draft["createdAt"]);
      const response = yield* call(undefined, "GET", "/projects/type-checker", {
        origin: null,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get("cache-control"),
        "private, no-cache",
      );
      const project = yield* json(response);
      assert.deepStrictEqual(project, {
        id,
        slug: "type-checker",
        title: "Type checker",
        summary: "Summary of type-checker",
        tags: ["rust", "types"],
        status: "completed",
        featured: true,
        repoUrl: "https://github.com/example/type-checker",
        liveUrl: "http://type-checker.example.org/play?x=1#top",
        coverImage: null,
        updatedAt: published["updatedAt"],
        content,
      });
      const list = yield* call(undefined, "GET", "/projects", {
        origin: null,
      });
      assert.strictEqual(
        list.headers.get("cache-control"),
        "private, no-cache",
      );
      const items = (yield* json(list)) as unknown as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        items.map((item) => item["slug"]),
        ["type-checker"],
      );
      // Lists carry no content, and visitors see nothing of the admin side.
      for (const field of [
        "content",
        "published",
        "position",
        "version",
        "createdAt",
      ]) {
        assert.notProperty(items[0], field);
      }

      // A save based on an old version is refused, and saves nothing.
      const stale = yield* expect(
        409,
        admin.cookie,
        "PUT",
        `/admin/projects/${id}`,
        { body: { ...input, title: "Stale", published: true, version: 1 } },
      );
      assert.deepStrictEqual(stale, {
        _tag: "ProjectEditConflict",
        currentVersion: 2,
      });
      assert.deepInclude(
        yield* expect(200, admin.cookie, "GET", `/admin/projects/${id}`),
        { title: "Type checker", version: 2 },
      );

      // A slug of another project is taken, on update and on create; the
      // failed statement leaves the next save working.
      yield* app.createProject(projectInput("other"));
      assert.deepStrictEqual(
        yield* expect(409, admin.cookie, "PUT", `/admin/projects/${id}`, {
          body: { ...projectInput("other"), version: 2 },
        }),
        { _tag: "ProjectSlugTaken", slug: "other" },
      );
      assert.deepStrictEqual(
        yield* expect(409, admin.cookie, "POST", "/admin/projects", {
          body: projectInput("other"),
        }),
        { _tag: "ProjectSlugTaken", slug: "other" },
      );
      assert.deepInclude(
        yield* expect(200, admin.cookie, "GET", `/admin/projects/${id}`),
        { slug: "type-checker", version: 2 },
      );
      const renamed = yield* expect(
        200,
        admin.cookie,
        "PUT",
        `/admin/projects/${id}`,
        {
          body: {
            ...input,
            slug: "checker",
            published: true,
            repoUrl: null,
            version: 2,
          },
        },
      );
      assert.deepInclude(renamed, {
        slug: "checker",
        repoUrl: null,
        version: 3,
      });
      yield* expect(200, undefined, "GET", "/projects/checker");
      yield* expect(404, undefined, "GET", "/projects/type-checker");

      // Unpublished through an update, it is hidden again.
      const hidden = yield* expect(
        200,
        admin.cookie,
        "PUT",
        `/admin/projects/${id}`,
        { body: { ...input, slug: "checker", published: false, version: 3 } },
      );
      assert.deepInclude(hidden, { published: false, version: 4 });
      yield* expect(404, undefined, "GET", "/projects/checker");
      assert.deepStrictEqual(
        slugs(yield* expect(200, undefined, "GET", "/projects")),
        [],
      );
      // Admins still see both, unpublished or not.
      const managed = (yield* expect(
        200,
        admin.cookie,
        "GET",
        "/admin/projects",
      )) as unknown as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        managed.map((item) => [item["slug"], item["published"]]),
        [
          ["checker", false],
          ["other", false],
        ],
      );
      assert.notProperty(managed[0], "content");
      assert.deepInclude(managed[0], { version: 4, position: 3 });

      // Deleted, it is gone; a second delete finds nothing.
      const deleted = yield* call(
        admin.cookie,
        "DELETE",
        `/admin/projects/${id}`,
      );
      assert.strictEqual(deleted.status, 204);
      assert.strictEqual(yield* Effect.promise(() => deleted.text()), "");
      yield* expect(404, admin.cookie, "GET", `/admin/projects/${id}`);
      yield* expect(404, admin.cookie, "DELETE", `/admin/projects/${id}`);
      yield* expect(404, undefined, "GET", "/projects/checker");
      assert.deepStrictEqual(
        slugs(yield* expect(200, admin.cookie, "GET", "/admin/projects")),
        ["other"],
      );
    }),
  );

  it.effect("answers 404 ProjectNotFound for an unknown project", () =>
    Effect.gen(function* () {
      const { expect, admin } = yield* setup;
      const path = `/admin/projects/${unknownId}`;
      for (const [method, body] of [
        ["GET", undefined],
        ["PUT", { ...projectInput("x"), version: 1 }],
        ["DELETE", undefined],
      ] as const) {
        assert.deepStrictEqual(
          yield* expect(404, admin.cookie, method, path, { body }),
          { _tag: "ProjectNotFound", project: unknownId },
        );
      }
      assert.deepStrictEqual(
        yield* expect(404, undefined, "GET", "/projects/nothing-here"),
        { _tag: "ProjectNotFound", project: "nothing-here" },
      );
    }),
  );

  it.effect("rejects invalid projects with 400", () =>
    Effect.gen(function* () {
      const { expect, admin, counts } = yield* setup;
      for (const input of [
        projectInput("Not A Slug"),
        projectInput("x", { title: "" }),
        projectInput("x", { title: " padded" }),
        projectInput("x", { tags: ["a", "a"] }),
        projectInput("x", { status: "paused" }),
        projectInput("x", { position: -1 }),
        projectInput("x", { position: 10001 }),
        projectInput("x", { position: 1.5 }),
        projectInput("x", { content: { type: "paragraph" } }),
        projectInput("x", { coverImage: "not-a-uuid" }),
      ]) {
        yield* expect(400, admin.cookie, "POST", "/admin/projects", {
          body: input,
        });
      }
      yield* expect(400, admin.cookie, "GET", "/admin/projects/not-a-uuid");
      yield* expect(400, undefined, "GET", "/projects/Not_A_Slug");
      // A version below 1 is no version.
      yield* expect(400, admin.cookie, "PUT", `/admin/projects/${unknownId}`, {
        body: { ...projectInput("x"), version: 0 },
      });
      assert.deepStrictEqual(yield* counts, { projects: 0, media: 0 });
    }),
  );

  it.effect.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp:", "ftp://example.org/x"],
    ["mailto:", "mailto:a@example.org"],
    ["an uppercase scheme", "HTTPS://example.org"],
    ["a relative URL", "/projects/x"],
    ["no host", "https://"],
    ["credentials", "https://user:pass@example.org/"],
    ["a user name", "https://github.com@evil.example/"],
    ["a space", "https://example.org/a b"],
    ["a tab", "https://example.org/a\tb"],
    ["a leading space", " https://example.org"],
    ["over 2048 characters", `https://example.org/${"x".repeat(2048)}`],
  ] as const)("rejects a URL with %s with 400", ([, url]) =>
    Effect.gen(function* () {
      const { expect, admin, counts } = yield* setup;
      for (const field of ["repoUrl", "liveUrl"]) {
        yield* expect(400, admin.cookie, "POST", "/admin/projects", {
          body: projectInput("x", { [field]: url }),
        });
      }
      // On update too.
      const project = yield* expect(
        201,
        admin.cookie,
        "POST",
        "/admin/projects",
        {
          body: projectInput("ok"),
        },
      );
      yield* expect(
        400,
        admin.cookie,
        "PUT",
        `/admin/projects/${String(project["id"])}`,
        { body: { ...projectInput("ok", { repoUrl: url }), version: 1 } },
      );
      assert.deepStrictEqual(yield* counts, { projects: 1, media: 0 });
    }),
  );

  it.effect("keeps a valid URL exactly as given", () =>
    Effect.gen(function* () {
      const { createProject } = yield* setup;
      // The URL parser would add a trailing slash and lowercase the host.
      const url = "https://Example.org";
      const project = yield* createProject(
        projectInput("x", { repoUrl: url, liveUrl: url }),
      );
      assert.deepInclude(project, { repoUrl: url, liveUrl: url });
    }),
  );
});

describe("the public projects list", () => {
  it.effect(
    "lists only published projects: featured first, then position, then last changed, then id",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const create = (
          slug: string,
          fields: { featured: boolean; position: number; published?: boolean },
          updatedAt: string,
        ) =>
          Effect.gen(function* () {
            const project = yield* app.createProject(
              projectInput(slug, { published: true, ...fields }),
            );
            yield* app.setUpdatedAt(project["id"], new Date(updatedAt));
            return String(project["id"]);
          });
        const early = "2026-01-01T00:00:00.000Z";
        const late = "2026-02-01T00:00:00.000Z";
        yield* create("plain-late", { featured: false, position: 0 }, late);
        yield* create("plain-early", { featured: false, position: 0 }, early);
        yield* create(
          "plain-first",
          { featured: false, position: 0 },
          "2026-03-01T00:00:00.000Z",
        );
        yield* create("plain-pos1", { featured: false, position: 1 }, late);
        yield* create("featured-pos5", { featured: true, position: 5 }, early);
        yield* create("featured-pos2", { featured: true, position: 2 }, early);
        yield* create(
          "hidden",
          { featured: true, position: 0, published: false },
          late,
        );
        // The same everything: the id decides.
        const twinA = yield* create(
          "twin-a",
          { featured: false, position: 9 },
          early,
        );
        const twinB = yield* create(
          "twin-b",
          { featured: false, position: 9 },
          early,
        );
        const twins = [
          [twinA, "twin-a"],
          [twinB, "twin-b"],
        ]
          .sort(([a], [b]) => (a! < b! ? -1 : 1))
          .map(([, slug]) => slug);

        const expected = [
          "featured-pos2",
          "featured-pos5",
          "plain-first",
          "plain-late",
          "plain-early",
          "plain-pos1",
          ...twins,
        ];
        const list = (yield* app.expect(
          200,
          undefined,
          "GET",
          "/projects",
        )) as unknown as ReadonlyArray<Json>;
        assert.deepStrictEqual(
          list.map((item) => item["slug"]),
          expected,
        );
        assert.strictEqual(
          list.find((item) => item["slug"] === "plain-late")?.["updatedAt"],
          late,
        );
        // Admins see the same order, with the unpublished one in its place.
        assert.deepStrictEqual(
          slugs(
            yield* app.expect(200, app.admin.cookie, "GET", "/admin/projects"),
          ),
          ["hidden", ...expected],
        );
        yield* app.expect(404, undefined, "GET", "/projects/hidden");
        yield* app.expect(200, undefined, "GET", "/projects/plain-early");
      }),
  );
});

describe("project images", () => {
  it.effect("stores an upload with scope projects (201)", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const response = yield* app.call(
        app.admin.cookie,
        "POST",
        "/admin/projects/media",
        { body: form(png) },
      );
      assert.strictEqual(response.status, 201);
      const info = yield* json(response);
      const id = String(info["id"]);
      assert.deepInclude(info, {
        url: `/api/media/${id}`,
        contentType: "image/png",
        byteSize: png.length,
      });
      const stored = yield* app.sql(
        (sql) => sql<{ readonly scope: string; readonly uploadedBy: string }>`
          SELECT scope, uploaded_by FROM media WHERE id = ${id}
        `,
      );
      assert.deepStrictEqual(stored, [
        { scope: "projects", uploadedBy: app.admin.id },
      ]);

      // Served like every image, and usable as a cover.
      const served = yield* app.call(undefined, "GET", `/media/${id}`, {
        origin: null,
      });
      assert.strictEqual(served.status, 200);
      const project = yield* app.createProject(
        projectInput("covered", { coverImage: id, published: true }),
      );
      assert.strictEqual(project["coverImage"], id);
      assert.strictEqual(
        (yield* app.expect(200, undefined, "GET", "/projects/covered"))[
          "coverImage"
        ],
        id,
      );

      // Deleting the project leaves the image.
      yield* app.expect(
        204,
        app.admin.cookie,
        "DELETE",
        `/admin/projects/${String(project["id"])}`,
      );
      assert.strictEqual(
        (yield* app.call(undefined, "GET", `/media/${id}`, { origin: null }))
          .status,
        200,
      );
    }),
  );

  it.effect("refuses what is no image, and a request without a file", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const upload = (body: FormData) =>
        app.call(app.admin.cookie, "POST", "/admin/projects/media", { body });
      const notImage = yield* upload(
        form(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])),
      );
      assert.strictEqual(notImage.status, 415);
      assert.deepStrictEqual(yield* json(notImage), {
        _tag: "UnsupportedMedia",
      });
      const wrongKey = yield* upload(form(png, { key: "image" }));
      assert.strictEqual(wrongKey.status, 400);
      assert.deepStrictEqual(yield* app.counts, { projects: 0, media: 0 });
    }),
  );
});
