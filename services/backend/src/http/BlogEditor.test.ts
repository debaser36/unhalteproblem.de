import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  doc,
  form,
  type Json,
  makeBlogApp,
  png,
  postInput,
  words,
} from "#testing/Blogs";

/** An id no post has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

/**
 * Every blog editor endpoint, as a request on subblog `blog` and post `id`.
 * Bodies are made fresh per call: a `FormData` can be sent only once.
 */
const endpoints = (blog: string, id: string) =>
  [
    {
      name: "listManagedPosts",
      method: "GET",
      path: `/blogs/${blog}/manage/posts`,
    },
    {
      name: "getManagedPost",
      method: "GET",
      path: `/blogs/${blog}/manage/posts/${id}`,
    },
    {
      name: "createPost",
      method: "POST",
      path: `/blogs/${blog}/manage/posts`,
      body: () => postInput("intruder"),
    },
    {
      name: "updatePost",
      method: "PUT",
      path: `/blogs/${blog}/manage/posts/${id}`,
      body: () => ({ ...postInput("intruder"), version: 1 }),
    },
    {
      name: "publishPost",
      method: "POST",
      path: `/blogs/${blog}/manage/posts/${id}/publish`,
    },
    {
      name: "unpublishPost",
      method: "POST",
      path: `/blogs/${blog}/manage/posts/${id}/unpublish`,
    },
    {
      name: "deletePost",
      method: "DELETE",
      path: `/blogs/${blog}/manage/posts/${id}`,
    },
    {
      name: "uploadMedia",
      method: "POST",
      path: `/blogs/${blog}/manage/media`,
      body: () => form(png),
    },
  ] as const;

type Endpoint = ReturnType<typeof endpoints>[number];

const bodyOf = (endpoint: Endpoint) =>
  "body" in endpoint ? endpoint.body() : undefined;

/** Subblogs `alpha` and `beta`, an editor of each, and a draft in `beta`. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha");
  yield* app.createBlog("beta");
  const alphaEditor = yield* app.editor("ed-alpha", "alpha");
  const betaEditor = yield* app.editor("ed-beta", "beta");
  const draft = yield* app.createPost(
    betaEditor.cookie,
    "beta",
    postInput("beta-draft"),
  );
  return { ...app, alphaEditor, betaEditor, draftId: String(draft["id"]) };
});

/** The post as its editor sees it, read with `cookie`. */
const managed = (
  app: Effect.Success<typeof setup>,
  cookie: string,
  blog: string,
  id: string,
) => app.expect(200, cookie, "GET", `/blogs/${blog}/manage/posts/${id}`);

describe("blog editor access", () => {
  it.effect("every endpoint requires a session (401)", () =>
    Effect.gen(function* () {
      const { call, draftId } = yield* setup;
      for (const endpoint of endpoints("beta", draftId)) {
        for (const cookie of [undefined, "unknown"]) {
          // Without Origin too: the session is checked first.
          for (const origin of [undefined, null]) {
            const response = yield* call(
              cookie,
              endpoint.method,
              endpoint.path,
              {
                body: bodyOf(endpoint),
                origin,
              },
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

  it.effect(
    "an editor of another subblog, a normal user, an admin and a superAdmin get 403",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const { call, draftId, alphaEditor, user, admin, superAdmin } = app;
        const outsiders = { alphaEditor, user, admin, superAdmin };
        for (const [who, { cookie }] of Object.entries(outsiders)) {
          for (const endpoint of endpoints("beta", draftId)) {
            const response = yield* call(
              cookie,
              endpoint.method,
              endpoint.path,
              {
                body: bodyOf(endpoint),
              },
            );
            const body = (yield* Effect.promise(() => response.json())) as Json;
            assert.strictEqual(
              response.status,
              403,
              `${who}: ${endpoint.name}`,
            );
            assert.strictEqual(body["_tag"], "Forbidden");
          }
        }
        // Nothing was changed, created or uploaded.
        const post = yield* managed(
          app,
          app.betaEditor.cookie,
          "beta",
          draftId,
        );
        assert.strictEqual(post["status"], "draft");
        assert.strictEqual(post["version"], 1);
        assert.strictEqual(post["slug"], "beta-draft");
        const counts = yield* app.sql(
          (sql) => sql<{ readonly posts: number; readonly media: number }>`
            SELECT (SELECT count(*)::int FROM blog_posts) AS posts,
                   (SELECT count(*)::int FROM media) AS media
          `,
        );
        assert.deepStrictEqual(counts, [{ posts: 1, media: 0 }]);
      }),
  );

  it.effect("the editor of alpha keeps access to alpha", () =>
    Effect.gen(function* () {
      const { expect, alphaEditor } = yield* setup;
      const post = yield* expect(
        201,
        alphaEditor.cookie,
        "POST",
        "/blogs/alpha/manage/posts",
        { body: postInput("mine") },
      );
      assert.strictEqual(post["blog"], "alpha");
      const list = yield* expect(
        200,
        alphaEditor.cookie,
        "GET",
        "/blogs/alpha/manage/posts",
      );
      assert.deepStrictEqual(
        (list as unknown as ReadonlyArray<Json>).map((item) => item["slug"]),
        ["mine"],
      );
    }),
  );

  it.effect(
    "state-changing endpoints require a same-origin request (403)",
    () =>
      Effect.gen(function* () {
        const { call, draftId, betaEditor } = yield* setup;
        const changing = endpoints("beta", draftId).filter(
          (endpoint) => endpoint.method !== "GET",
        );
        for (const endpoint of changing) {
          for (const origin of [null, "https://evil.example"]) {
            const response = yield* call(
              betaEditor.cookie,
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
      }),
  );

  it.effect("editor responses must not be cached", () =>
    Effect.gen(function* () {
      const { call, draftId, betaEditor } = yield* setup;
      for (const path of [
        "/blogs/beta/manage/posts",
        `/blogs/beta/manage/posts/${draftId}`,
      ]) {
        const response = yield* call(betaEditor.cookie, "GET", path);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get("cache-control"), "no-store");
      }
    }),
  );
});

describe("writing a post", () => {
  it.effect("from a new subblog to a deleted post", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      const { expect, call, admin, superAdmin } = app;

      // An admin creates the subblog.
      const blog = yield* app.createBlog("rust-notes", "Rust notes");
      assert.deepInclude(blog, {
        slug: "rust-notes",
        title: "Rust notes",
        description: "About rust-notes",
        postCount: 0,
        latestPostAt: null,
      });

      // A superAdmin makes "ed" its editor; there is no role for a subblog
      // that does not exist.
      const ed = yield* app.member("ed");
      const unknown = yield* expect(
        404,
        superAdmin.cookie,
        "PUT",
        `/admin/users/${ed.id}/roles/blogEditor:ghost`,
      );
      assert.deepStrictEqual(unknown, { _tag: "BlogNotFound", blog: "ghost" });
      yield* expect(
        204,
        superAdmin.cookie,
        "PUT",
        `/admin/users/${ed.id}/roles/blogEditor:rust-notes`,
      );
      const roles = yield* app.sql(
        (sql) => sql<{ readonly role: string }>`
          SELECT role FROM user_roles WHERE user_id = ${ed.id} ORDER BY role
        `,
      );
      assert.deepStrictEqual(
        roles.map(({ role }) => role),
        ["blogEditor:rust-notes", "normalUser"],
      );

      // The editor writes a draft.
      const content = doc(words(300), words(140));
      const created = yield* call(
        ed.cookie,
        "POST",
        "/blogs/rust-notes/manage/posts",
        { body: postInput("hello", { content, tags: ["rust"] }) },
      );
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.headers.get("cache-control"), "no-store");
      const draft = (yield* Effect.promise(() => created.json())) as Json;
      const id = String(draft["id"]);
      assert.deepInclude(draft, {
        blog: "rust-notes",
        slug: "hello",
        status: "draft",
        publishedAt: null,
        version: 1,
        tags: ["rust"],
        author: { name: "ada" },
      });
      assert.deepStrictEqual(draft["content"], content);

      // Drafts are no business of readers.
      const hidden = yield* expect(
        404,
        undefined,
        "GET",
        "/blogs/rust-notes/posts/hello",
      );
      assert.strictEqual(hidden["_tag"], "PostNotFound");
      const noPosts = { posts: [], nextCursor: null };
      assert.deepStrictEqual(
        yield* expect(200, undefined, "GET", "/blogs/rust-notes/posts"),
        noPosts,
      );
      assert.deepStrictEqual(
        yield* expect(200, undefined, "GET", "/posts"),
        noPosts,
      );
      assert.deepInclude(
        yield* expect(200, undefined, "GET", "/blogs/rust-notes"),
        { postCount: 0, latestPostAt: null },
      );

      // Published, everyone sees it, with its author and reading time.
      const published = yield* app.publish(ed.cookie, "rust-notes", id);
      assert.strictEqual(published["status"], "published");
      assert.strictEqual(published["version"], 2);
      const publishedAt = published["publishedAt"];
      assert.isString(publishedAt);
      const response = yield* call(
        undefined,
        "GET",
        "/blogs/rust-notes/posts/hello",
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get("cache-control"),
        "private, no-cache",
      );
      const post = (yield* Effect.promise(() => response.json())) as Json;
      assert.deepInclude(post, {
        id,
        blog: "rust-notes",
        slug: "hello",
        title: "Title of hello",
        publishedAt,
        author: { name: "ada" },
        readingMinutes: 2,
      });
      assert.deepStrictEqual(post["content"], content);
      assert.deepInclude(
        yield* expect(200, undefined, "GET", "/blogs/rust-notes"),
        { postCount: 1, latestPostAt: publishedAt },
      );

      // Publishing again changes nothing.
      const again = yield* app.publish(ed.cookie, "rust-notes", id);
      assert.strictEqual(again["version"], 2);
      assert.strictEqual(again["publishedAt"], publishedAt);

      // A save based on an old version is refused, and saves nothing.
      const stale = yield* expect(
        409,
        ed.cookie,
        "PUT",
        `/blogs/rust-notes/manage/posts/${id}`,
        { body: { ...postInput("hello", { title: "Stale" }), version: 1 } },
      );
      assert.deepStrictEqual(stale, {
        _tag: "PostEditConflict",
        currentVersion: 2,
      });
      const saved = yield* expect(
        200,
        ed.cookie,
        "PUT",
        `/blogs/rust-notes/manage/posts/${id}`,
        { body: { ...postInput("hello", { title: "Fresh" }), version: 2 } },
      );
      assert.deepInclude(saved, {
        title: "Fresh",
        version: 3,
        status: "published",
        publishedAt,
      });

      // A slug of another post is taken, on update and on create; the
      // failed statement leaves the next save working.
      yield* app.createPost(ed.cookie, "rust-notes", postInput("other"));
      const taken = yield* expect(
        409,
        ed.cookie,
        "PUT",
        `/blogs/rust-notes/manage/posts/${id}`,
        { body: { ...postInput("other"), version: 3 } },
      );
      assert.deepStrictEqual(taken, { _tag: "PostSlugTaken", slug: "other" });
      assert.deepStrictEqual(
        yield* expect(
          409,
          ed.cookie,
          "POST",
          "/blogs/rust-notes/manage/posts",
          {
            body: postInput("other"),
          },
        ),
        { _tag: "PostSlugTaken", slug: "other" },
      );
      const unchanged = yield* expect(
        200,
        ed.cookie,
        "GET",
        `/blogs/rust-notes/manage/posts/${id}`,
      );
      assert.deepInclude(unchanged, { slug: "hello", version: 3 });
      const renamed = yield* expect(
        200,
        ed.cookie,
        "PUT",
        `/blogs/rust-notes/manage/posts/${id}`,
        { body: { ...postInput("hello-again"), version: 3 } },
      );
      assert.deepInclude(renamed, { slug: "hello-again", version: 4 });
      yield* expect(
        200,
        undefined,
        "GET",
        "/blogs/rust-notes/posts/hello-again",
      );
      yield* expect(404, undefined, "GET", "/blogs/rust-notes/posts/hello");

      // Unpublished, it is hidden again; republished, it keeps its first
      // publication time (moved back in SQL, so a new one would differ).
      const first = "2026-01-01T00:00:00.000Z";
      yield* app.setPublishedAt(id, new Date(first));
      const unpublished = yield* expect(
        200,
        ed.cookie,
        "POST",
        `/blogs/rust-notes/manage/posts/${id}/unpublish`,
      );
      assert.deepInclude(unpublished, {
        status: "draft",
        publishedAt: first,
        version: 5,
      });
      yield* expect(
        404,
        undefined,
        "GET",
        "/blogs/rust-notes/posts/hello-again",
      );
      assert.deepInclude(
        yield* expect(200, undefined, "GET", "/blogs/rust-notes"),
        { postCount: 0, latestPostAt: null },
      );
      // Unpublishing a draft changes nothing.
      const still = yield* expect(
        200,
        ed.cookie,
        "POST",
        `/blogs/rust-notes/manage/posts/${id}/unpublish`,
      );
      assert.strictEqual(still["version"], 5);
      const republished = yield* app.publish(ed.cookie, "rust-notes", id);
      assert.deepInclude(republished, {
        status: "published",
        publishedAt: first,
        version: 6,
      });
      assert.strictEqual(
        (yield* expect(
          200,
          undefined,
          "GET",
          "/blogs/rust-notes/posts/hello-again",
        ))["publishedAt"],
        first,
      );

      // The editors' list has both posts, last changed first.
      const list = (yield* expect(
        200,
        ed.cookie,
        "GET",
        "/blogs/rust-notes/manage/posts",
      )) as unknown as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        list.map((item) => [item["slug"], item["status"]]),
        [
          ["hello-again", "published"],
          ["other", "draft"],
        ],
      );
      assert.notProperty(list[0], "content");

      // Deleted, it is gone for everyone.
      const deleted = yield* call(
        ed.cookie,
        "DELETE",
        `/blogs/rust-notes/manage/posts/${id}`,
      );
      assert.strictEqual(deleted.status, 204);
      yield* expect(
        404,
        ed.cookie,
        "GET",
        `/blogs/rust-notes/manage/posts/${id}`,
      );
      yield* expect(
        404,
        undefined,
        "GET",
        "/blogs/rust-notes/posts/hello-again",
      );
      yield* expect(
        404,
        ed.cookie,
        "DELETE",
        `/blogs/rust-notes/manage/posts/${id}`,
      );

      // The admin was never an editor.
      yield* expect(403, admin.cookie, "GET", "/blogs/rust-notes/manage/posts");
    }),
  );

  it.effect("answers 404 PostNotFound for an unknown post", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const { cookie } = yield* app.editor("ed", "alpha");
      const base = `/blogs/alpha/manage/posts/${unknownId}`;
      for (const [method, path, body] of [
        ["GET", base, undefined],
        ["PUT", base, { ...postInput("x"), version: 1 }],
        ["POST", `${base}/publish`, undefined],
        ["POST", `${base}/unpublish`, undefined],
        ["DELETE", base, undefined],
      ] as const) {
        const error = yield* app.expect(404, cookie, method, path, { body });
        assert.deepStrictEqual(error, {
          _tag: "PostNotFound",
          post: unknownId,
        });
      }
    }),
  );

  it.effect("a post of one subblog is not found through another", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      yield* app.createBlog("beta");
      const { cookie } = yield* app.editor("ed", "alpha", "beta");
      const post = yield* app.createPost(cookie, "alpha", postInput("same"));
      yield* app.expect(
        404,
        cookie,
        "GET",
        `/blogs/beta/manage/posts/${String(post["id"])}`,
      );
      yield* app.expect(
        404,
        cookie,
        "POST",
        `/blogs/beta/manage/posts/${String(post["id"])}/publish`,
      );
      // Slugs are unique per subblog only.
      yield* app.createPost(cookie, "beta", postInput("same"));
    }),
  );

  it.effect(
    "an editor role of a subblog that does not exist finds nothing",
    () =>
      Effect.gen(function* () {
        const app = yield* makeBlogApp();
        // Only possible in SQL: the API grants no role for an unknown subblog.
        const { cookie } = yield* app.editor("ed", "ghost");
        assert.deepStrictEqual(
          yield* app.expect(404, cookie, "POST", "/blogs/ghost/manage/posts", {
            body: postInput("x"),
          }),
          { _tag: "BlogNotFound", blog: "ghost" },
        );
        assert.deepStrictEqual(
          yield* app
            .call(cookie, "GET", "/blogs/ghost/manage/posts")
            .pipe(
              Effect.flatMap((response) =>
                Effect.promise(() => response.json()),
              ),
            ),
          [],
        );
        yield* app.expect(
          404,
          cookie,
          "GET",
          `/blogs/ghost/manage/posts/${unknownId}`,
        );
      }),
  );

  it.effect("hides the author's name once their account is deleted", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const ed = yield* app.editor("ed", "alpha");
      const post = yield* app.createPost(
        ed.cookie,
        "alpha",
        postInput("hello"),
      );
      yield* app.publish(ed.cookie, "alpha", post["id"]);
      const before = yield* app.expect(
        200,
        undefined,
        "GET",
        "/blogs/alpha/posts/hello",
      );
      assert.deepStrictEqual(before["author"], { name: "ada" });

      yield* app.expect(204, ed.cookie, "POST", "/account/delete");

      const after = yield* app.expect(
        200,
        undefined,
        "GET",
        "/blogs/alpha/posts/hello",
      );
      assert.deepStrictEqual(after["author"], { name: null });
      const page = yield* app.expect(200, undefined, "GET", "/posts");
      assert.deepStrictEqual(
        (page["posts"] as ReadonlyArray<Json>).map((item) => item["author"]),
        [{ name: null }],
      );
    }),
  );

  it.effect("rejects invalid posts with 400", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const { cookie } = yield* app.editor("ed", "alpha");
      for (const input of [
        postInput("Not A Slug"),
        postInput("x", { title: "" }),
        postInput("x", { tags: ["a", "a"] }),
        postInput("x", { content: { type: "paragraph" } }),
        postInput("x", {
          content: {
            type: "doc",
            content: [{ type: "script", content: [] }],
          },
        }),
      ]) {
        yield* app.expect(400, cookie, "POST", "/blogs/alpha/manage/posts", {
          body: input,
        });
      }
      yield* app.expect(
        400,
        cookie,
        "GET",
        "/blogs/alpha/manage/posts/not-a-uuid",
      );
    }),
  );
});
