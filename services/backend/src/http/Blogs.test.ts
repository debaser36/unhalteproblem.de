import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Json, makeBlogApp, postInput } from "#testing/Blogs";

type Page = {
  readonly posts: ReadonlyArray<Json>;
  readonly nextCursor: unknown;
};

/** Subblogs `alpha` and `beta` and an editor of both. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha", "Alpha");
  yield* app.createBlog("beta", "Beta");
  const editor = yield* app.editor("ed", "alpha", "beta");

  /**
   * Creates and publishes a post, then sets its first publication time to
   * `minute` minutes after 2026-01-01 (equal minutes make ties, broken by
   * id). Returns its id and time.
   */
  const post = (
    blog: string,
    slug: string,
    minute: number,
    tags: ReadonlyArray<string> = [],
  ) =>
    Effect.gen(function* () {
      const created = yield* app.createPost(
        editor.cookie,
        blog,
        postInput(slug, { tags }),
      );
      const id = String(created["id"]);
      yield* app.publish(editor.cookie, blog, id);
      const publishedAt = new Date(Date.UTC(2026, 0, 1, 0, minute));
      yield* app.setPublishedAt(id, publishedAt);
      return { id, slug, blog, publishedAt: publishedAt.toISOString() };
    });

  /** Pages through `path` with `query`; returns every page. */
  const pages = (path: string, query: Record<string, string>) =>
    Effect.gen(function* () {
      const result: Array<Page> = [];
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({
          ...query,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const page = (yield* app.expect(
          200,
          undefined,
          "GET",
          `${path}?${params}`,
        )) as unknown as Page;
        result.push(page);
        cursor = page.nextCursor === null ? undefined : String(page.nextCursor);
        assert.isAtMost(result.length, 20, "paging does not end");
      } while (cursor !== undefined);
      return result;
    });

  return { ...app, editor, post, pages };
});

type Posted = Effect.Success<ReturnType<Effect.Success<typeof setup>["post"]>>;

/** Newest first, then by id, descending: the feed's order. */
const feedOrder = (posts: ReadonlyArray<Posted>) =>
  [...posts]
    .sort((a, b) =>
      a.publishedAt === b.publishedAt
        ? b.id.localeCompare(a.id)
        : b.publishedAt.localeCompare(a.publishedAt),
    )
    .map(({ id }) => id);

const idsOf = (pages: ReadonlyArray<Page>) =>
  pages.flatMap((page) => page.posts.map((post) => String(post["id"])));

describe("blogs listBlogs and getBlog", () => {
  it.effect("lists every subblog by title, with its published posts", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      yield* app.createBlog("aardvark", "Zebra");
      yield* app.post("beta", "one", 1);
      const latest = yield* app.post("beta", "two", 5);
      yield* app.createPost(app.editor.cookie, "beta", postInput("draft"));

      const response = yield* app.call(undefined, "GET", "/blogs");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get("cache-control"),
        "private, no-cache",
      );
      const blogs = (yield* Effect.promise(() =>
        response.json(),
      )) as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        blogs.map((blog) => [blog["slug"], blog["postCount"]]),
        [
          ["alpha", 0],
          ["beta", 2],
          ["aardvark", 0],
        ],
      );
      assert.strictEqual(blogs[1]?.["latestPostAt"], latest.publishedAt);

      const beta = yield* app.expect(200, undefined, "GET", "/blogs/beta");
      assert.deepStrictEqual(beta, blogs[1]);
    }),
  );

  it.effect("answers 404 BlogNotFound for an unknown subblog", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      for (const path of [
        "/blogs/ghost",
        "/blogs/ghost/posts",
        "/blogs/ghost/posts/hello",
      ]) {
        assert.deepStrictEqual(yield* app.expect(404, undefined, "GET", path), {
          _tag: "BlogNotFound",
          blog: "ghost",
        });
      }
    }),
  );
});

describe("blogs paging", () => {
  it.effect(
    "pages through a subblog newest first, without gaps or duplicates",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const posted: Array<Posted> = [];
        // Ties at minutes 3 and 7, and a post of the other subblog between.
        for (const [slug, minute] of [
          ["p1", 1],
          ["p2", 3],
          ["p3", 3],
          ["p4", 3],
          ["p5", 7],
          ["p6", 7],
          ["p7", 9],
        ] as const) {
          posted.push(yield* app.post("alpha", slug, minute));
        }
        yield* app.post("beta", "elsewhere", 4);
        yield* app.createPost(app.editor.cookie, "alpha", postInput("draft"));

        const pages = yield* app.pages("/blogs/alpha/posts", { limit: "3" });
        assert.deepStrictEqual(
          pages.map((page) => page.posts.length),
          [3, 3, 1],
        );
        assert.deepStrictEqual(idsOf(pages), feedOrder(posted));
        assert.isNull(pages.at(-1)?.nextCursor);

        // Without a limit, ten at most.
        const all = yield* app.expect(
          200,
          undefined,
          "GET",
          "/blogs/alpha/posts",
        );
        assert.deepStrictEqual(
          (all["posts"] as ReadonlyArray<Json>).map((post) => post["id"]),
          feedOrder(posted),
        );
        assert.isNull(all["nextCursor"]);
      }),
  );

  it.effect("a full last page has no next cursor", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      yield* app.post("alpha", "p1", 1);
      yield* app.post("alpha", "p2", 2);
      const pages = yield* app.pages("/blogs/alpha/posts", { limit: "2" });
      assert.deepStrictEqual(
        pages.map((page) => page.posts.length),
        [2],
      );
    }),
  );

  it.effect("lists only posts with the tag, paged", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const tagged = [
        yield* app.post("alpha", "t1", 1, ["rust", "types"]),
        yield* app.post("alpha", "t2", 2, ["rust"]),
        yield* app.post("alpha", "t3", 2, ["rust"]),
      ];
      yield* app.post("alpha", "u1", 3, ["types"]);
      yield* app.post("alpha", "u2", 4);
      const pages = yield* app.pages("/blogs/alpha/posts", {
        limit: "2",
        tag: "rust",
      });
      assert.deepStrictEqual(idsOf(pages), feedOrder(tagged));
      for (const post of pages.flatMap((page) => page.posts)) {
        assert.include(post["tags"] as ReadonlyArray<string>, "rust");
      }
      const none = yield* app.expect(
        200,
        undefined,
        "GET",
        "/blogs/alpha/posts?tag=nothing",
      );
      assert.deepStrictEqual(none, { posts: [], nextCursor: null });
    }),
  );

  it.effect("recentPosts pages through every subblog together", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const posted = [
        yield* app.post("alpha", "a1", 1, ["rust"]),
        yield* app.post("beta", "b1", 2),
        yield* app.post("alpha", "a2", 2, ["rust"]),
        yield* app.post("beta", "b2", 5, ["rust"]),
        yield* app.post("alpha", "a3", 6),
      ];
      yield* app.createPost(app.editor.cookie, "beta", postInput("draft"));

      const pages = yield* app.pages("/posts", { limit: "2" });
      assert.deepStrictEqual(idsOf(pages), feedOrder(posted));
      const items = pages.flatMap((page) => page.posts);
      assert.deepStrictEqual(
        items.map((post) => post["blog"]),
        feedOrder(posted).map(
          (id) => posted.find((post) => post.id === id)?.blog,
        ),
      );
      // List items carry no content, but the reading time.
      for (const item of items) {
        assert.notProperty(item, "content");
        assert.strictEqual(item["readingMinutes"], 1);
      }

      const rust = yield* app.pages("/posts", { limit: "2", tag: "rust" });
      assert.deepStrictEqual(
        idsOf(rust),
        feedOrder(posted.filter(({ slug }) => slug !== "b1" && slug !== "a3")),
      );
    }),
  );

  it.effect("rejects a malformed cursor or limit with 400", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      for (const query of [
        "cursor=not-a-cursor",
        `cursor=${Buffer.from('[1,"not-a-uuid"]').toString("base64url")}`,
        "limit=0",
        "limit=51",
        "limit=two",
        "tag=Not%20A%20Tag",
      ]) {
        for (const path of ["/posts", "/blogs/alpha/posts"]) {
          yield* app.expect(400, undefined, "GET", `${path}?${query}`);
        }
      }
    }),
  );
});

describe("admin createBlog and updateBlog", () => {
  const payload = {
    slug: "new-blog",
    title: "New",
    description: "",
    categories: { main: "Programming", extra: [] },
  };

  it.effect(
    "require a session (401), admin (403) and a same-origin request",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const { call, admin, superAdmin, user, editor } = app;
        const requests = [
          ["POST", "/admin/blogs", payload],
          [
            "PATCH",
            "/admin/blogs/alpha",
            { title: "Renamed", description: "" },
          ],
        ] as const;
        for (const [method, path, body] of requests) {
          for (const cookie of [undefined, "unknown"]) {
            const response = yield* call(cookie, method, path, { body });
            assert.strictEqual(response.status, 401, `${method} ${path}`);
          }
          for (const { cookie } of [user, editor, superAdmin]) {
            const response = yield* call(cookie, method, path, { body });
            assert.strictEqual(response.status, 403, `${method} ${path}`);
          }
          for (const origin of [null, "https://evil.example"]) {
            const response = yield* call(admin.cookie, method, path, {
              body,
              origin,
            });
            assert.strictEqual(response.status, 403, `${method} ${path}`);
          }
        }
        yield* app.expect(404, undefined, "GET", "/blogs/new-blog");
        assert.strictEqual(
          (yield* app.expect(200, undefined, "GET", "/blogs/alpha"))["title"],
          "Alpha",
        );
      }),
  );

  it.effect(
    "creates with 201 and answers 409 BlogSlugTaken for a taken slug",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const created = yield* app.expect(
          201,
          app.admin.cookie,
          "POST",
          "/admin/blogs",
          {
            body: payload,
          },
        );
        assert.deepInclude(created, {
          slug: payload.slug,
          title: payload.title,
          description: payload.description,
          categories: {
            main: { slug: "programming", name: "Programming" },
            extra: [],
          },
          postCount: 0,
          latestPostAt: null,
        });
        const taken = yield* app.expect(
          409,
          app.admin.cookie,
          "POST",
          "/admin/blogs",
          {
            body: { ...payload, title: "Other" },
          },
        );
        assert.deepStrictEqual(taken, {
          _tag: "BlogSlugTaken",
          blog: "new-blog",
        });
        // The first one is untouched, and the next create works.
        assert.strictEqual(
          (yield* app.expect(200, undefined, "GET", "/blogs/new-blog"))[
            "title"
          ],
          "New",
        );
        yield* app.createBlog("newer-blog");
        const creator = yield* app.sql(
          (sql) => sql<{ readonly createdBy: string }>`
          SELECT created_by FROM blogs WHERE slug = 'new-blog'
        `,
        );
        assert.deepStrictEqual(creator, [{ createdBy: app.admin.id }]);
      }),
  );

  it.effect("updates title and description, never the slug", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const updated = yield* app.expect(
        200,
        app.admin.cookie,
        "PATCH",
        "/admin/blogs/alpha",
        { body: { title: "Renamed", description: "Now with text", slug: "x" } },
      );
      assert.deepInclude(updated, {
        slug: "alpha",
        title: "Renamed",
        description: "Now with text",
      });
      assert.deepStrictEqual(
        yield* app.expect(200, undefined, "GET", "/blogs/alpha"),
        updated,
      );
      assert.deepStrictEqual(
        yield* app.expect(
          404,
          app.admin.cookie,
          "PATCH",
          "/admin/blogs/ghost",
          {
            body: { title: "Ghost", description: "" },
          },
        ),
        { _tag: "BlogNotFound", blog: "ghost" },
      );
    }),
  );

  it.effect("rejects invalid subblogs with 400", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      for (const body of [
        { ...payload, slug: "Not-A-Slug" },
        { ...payload, slug: "double--hyphen" },
        { ...payload, slug: "a".repeat(65) },
        { ...payload, title: "" },
        { ...payload, title: " padded " },
        { ...payload, description: "x".repeat(1001) },
      ]) {
        yield* app.expect(400, app.admin.cookie, "POST", "/admin/blogs", {
          body,
        });
      }
    }),
  );
});
