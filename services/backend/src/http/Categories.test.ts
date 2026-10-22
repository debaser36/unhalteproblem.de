import { assert, describe, it } from "@effect/vitest";
import { PresetCategories } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { doc, type Json, makeBlogApp, postInput, words } from "#testing/Blogs";

type App = Effect.Success<ReturnType<typeof makeBlogApp>>;

const list = (body: unknown) => body as unknown as ReadonlyArray<Json>;

const slugs = (posts: ReadonlyArray<Json>) => posts.map((p) => p["slug"]);

/** The audit entries of `actions`, oldest first: `[action, detail]`. */
const audit = (app: App, ...actions: ReadonlyArray<string>) =>
  app
    .sql(
      (sql) => sql<{
        readonly action: string;
        readonly detail: string | null;
      }>`
        SELECT action, detail FROM audit_log
        WHERE ${sql.in("action", actions)}
        ORDER BY id
      `,
    )
    .pipe(Effect.map((rows) => rows.map((r) => [r.action, r.detail])));

const categoriesOf = (app: App) =>
  app.expect(200, undefined, "GET", "/categories").pipe(Effect.map(list));

const bySlug = (categories: ReadonlyArray<Json>, slug: string) =>
  categories.find((c) => c["slug"] === slug);

const ref = (slug: string, name: string) => ({ slug, name });

/** Creates a blog as admin with these category names. */
const adminBlog = (
  app: App,
  slug: string,
  main: string,
  extra: ReadonlyArray<string> = [],
) =>
  app.expect(201, app.admin.cookie, "POST", "/admin/blogs", {
    body: {
      slug,
      title: `Blog ${slug}`,
      description: "",
      categories: { main, extra },
    },
  });

describe("categories listing", () => {
  it.effect(
    "lists the presets by name, counting blogs and published posts",
    () =>
      Effect.gen(function* () {
        const app = yield* makeBlogApp();
        const empty = yield* categoriesOf(app);
        assert.strictEqual(empty.length, PresetCategories.length);
        assert.deepStrictEqual(
          empty.map((c) => c["name"]),
          [...PresetCategories].sort((a, b) => a.localeCompare(b)),
        );
        assert.isTrue(
          empty.every((c) => c["blogCount"] === 0 && c["postCount"] === 0),
        );
        assert.deepStrictEqual(bySlug(empty, "web-development"), {
          slug: "web-development",
          name: "Web Development",
          blogCount: 0,
          postCount: 0,
        });

        yield* app.createBlog("alpha"); // Programming
        yield* adminBlog(app, "beta", "Open Source", ["Programming"]);
        const ed = yield* app.editor("ed", "alpha");
        const published = yield* app.createPost(
          ed.cookie,
          "alpha",
          postInput("one", {
            categories: {
              main: "Security",
              extra: ["Programming", "Web Development"],
            },
          }),
        );
        yield* app.publish(ed.cookie, "alpha", published["id"]);
        // A draft counts for nothing.
        yield* app.createPost(
          ed.cookie,
          "alpha",
          postInput("draft", {
            categories: { main: "Career", extra: ["Security"] },
          }),
        );

        const counts = yield* categoriesOf(app);
        const pick = (slug: string) => {
          const c = bySlug(counts, slug);
          return [c?.["blogCount"], c?.["postCount"]];
        };
        assert.deepStrictEqual(pick("programming"), [2, 1]); // extra of beta and of the post
        assert.deepStrictEqual(pick("open-source"), [1, 0]);
        assert.deepStrictEqual(pick("security"), [0, 1]);
        assert.deepStrictEqual(pick("web-development"), [0, 1]);
        assert.deepStrictEqual(pick("career"), [0, 0]);
      }),
  );
});

describe("implicit category creation", () => {
  it.effect("creates new categories, reuses known ones and audits", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const ed = yield* app.editor("ed", "alpha");
      const post = yield* app.createPost(
        ed.cookie,
        "alpha",
        postInput("one", {
          categories: {
            main: "Rust Things",
            extra: ["web development", "Security"],
          },
        }),
      );
      assert.deepStrictEqual(post["categories"], {
        main: ref("rust-things", "Rust Things"),
        extra: [
          ref("security", "Security"),
          ref("web-development", "Web Development"),
        ],
      });
      assert.deepStrictEqual(yield* audit(app, "category_created"), [
        ["category_created", "rust-things"],
      ]);
      const all = yield* categoriesOf(app);
      assert.strictEqual(all.length, PresetCategories.length + 1);
      assert.strictEqual(
        bySlug(all, "web-development")?.["name"],
        "Web Development",
      );

      // Another spelling of the same name is the same category.
      const again = yield* app.createPost(
        ed.cookie,
        "alpha",
        postInput("two", { categories: { main: "RUST  things!!", extra: [] } }),
      );
      assert.deepStrictEqual(
        (again["categories"] as Json)["main"],
        ref("rust-things", "Rust Things"),
      );
      assert.lengthOf(yield* audit(app, "category_created"), 1);
      assert.strictEqual(
        (yield* categoriesOf(app)).length,
        PresetCategories.length + 1,
      );
    }),
  );

  it.effect("creates no category when the save is refused", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const ed = yield* app.editor("ed", "alpha");
      yield* app.createPost(ed.cookie, "alpha", postInput("taken"));
      const refused = yield* app.expect(
        409,
        ed.cookie,
        "POST",
        "/blogs/alpha/manage/posts",
        {
          body: postInput("taken", {
            categories: { main: "Brand New", extra: ["Another New"] },
          }),
        },
      );
      assert.strictEqual(refused["_tag"], "PostSlugTaken");
      const all = yield* categoriesOf(app);
      assert.isUndefined(bySlug(all, "brand-new"));
      assert.isUndefined(bySlug(all, "another-new"));
      assert.lengthOf(yield* audit(app, "category_created"), 0);
    }),
  );

  it.effect("rejects invalid category inputs with 400", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      const ed = yield* app.editor("ed", "alpha");
      const invalid: ReadonlyArray<readonly [string, unknown]> = [
        [
          "four extras",
          {
            main: "Programming",
            extra: ["Security", "Career", "Personal", "Open Source"],
          },
        ],
        ["main repeated as extra", { main: "Security", extra: ["security"] }],
        [
          "main repeated by slug",
          { main: "Web Development", extra: ["web-development!"] },
        ],
        [
          "extras repeated",
          { main: "Career", extra: ["Security", "SECURITY"] },
        ],
        ["no slug", { main: "!!!", extra: [] }],
        ["no slug extra", { main: "Career", extra: ["???"] }],
        ["49 characters", { main: "a".repeat(49), extra: [] }],
        ["49 characters extra", { main: "Career", extra: ["b".repeat(49)] }],
      ];
      for (const [label, categories] of invalid) {
        const response = yield* app.call(
          ed.cookie,
          "POST",
          "/blogs/alpha/manage/posts",
          { body: postInput("bad", { categories }) },
        );
        assert.strictEqual(response.status, 400, label);
        const blog = yield* app.call(
          ed.cookie,
          "PUT",
          "/blogs/alpha/manage/categories",
          { body: categories },
        );
        assert.strictEqual(blog.status, 400, `blog: ${label}`);
        const created = yield* app.call(
          app.admin.cookie,
          "POST",
          "/admin/blogs",
          {
            body: { slug: "gamma", title: "G", description: "", categories },
          },
        );
        assert.strictEqual(created.status, 400, `admin blog: ${label}`);
      }
      // 48 characters are fine.
      yield* app.createPost(
        ed.cookie,
        "alpha",
        postInput("fine", { categories: { main: "a".repeat(48), extra: [] } }),
      );
    }),
  );
});

describe("PUT /blogs/:blog/manage/categories", () => {
  it.effect("is limited to editors of the blog with an origin", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      yield* app.createBlog("beta");
      const ed = yield* app.editor("ed", "alpha");
      const other = yield* app.editor("other", "beta");
      const path = "/blogs/alpha/manage/categories";
      const body = { main: "Security", extra: ["Brand New"] };

      const status = (cookie: string | undefined, origin?: string | null) =>
        app
          .call(cookie, "PUT", path, { body, origin })
          .pipe(Effect.map((r) => r.status));
      assert.strictEqual(yield* status(undefined), 401);
      assert.strictEqual(yield* status(other.cookie), 403);
      assert.strictEqual(yield* status(app.user.cookie), 403);
      assert.strictEqual(yield* status(ed.cookie, null), 403);
      // Nothing was created by the refused calls.
      assert.isUndefined(bySlug(yield* categoriesOf(app), "brand-new"));

      const updated = yield* app.expect(200, ed.cookie, "PUT", path, { body });
      const expected = {
        main: ref("security", "Security"),
        extra: [ref("brand-new", "Brand New")],
      };
      assert.deepStrictEqual(updated["categories"], expected);
      const one = yield* app.expect(200, undefined, "GET", "/blogs/alpha");
      assert.deepStrictEqual(one["categories"], expected);
      const all = list(yield* app.expect(200, undefined, "GET", "/blogs"));
      assert.deepStrictEqual(
        all.find((b) => b["slug"] === "alpha")?.["categories"],
        expected,
      );
      // The other blog is untouched.
      assert.deepStrictEqual(
        all.find((b) => b["slug"] === "beta")?.["categories"],
        { main: ref("programming", "Programming"), extra: [] },
      );
    }),
  );
});

describe("categories of new blogs", () => {
  it.effect("an approved blog request starts in Miscellaneous", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      const request = yield* app.expect(
        201,
        app.user.cookie,
        "POST",
        "/blog-requests",
        {
          body: { title: "Rust notes", description: "Notes" },
        },
      );
      yield* app.expect(
        200,
        app.admin.cookie,
        "POST",
        `/admin/blog-requests/${String(request["id"])}/approve`,
        { body: { slug: "approved-one" } },
      );
      const blog = yield* app.expect(
        200,
        undefined,
        "GET",
        "/blogs/approved-one",
      );
      assert.deepStrictEqual(blog["categories"], {
        main: ref("miscellaneous", "Miscellaneous"),
        extra: [],
      });
      assert.strictEqual(
        bySlug(yield* categoriesOf(app), "miscellaneous")?.["blogCount"],
        1,
      );
    }),
  );

  it.effect("an admin creates a blog with new categories", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      const blog = yield* adminBlog(app, "gamma", "Garden Notes", ["Career"]);
      assert.deepStrictEqual(blog["categories"], {
        main: ref("garden-notes", "Garden Notes"),
        extra: [ref("career", "Career")],
      });
      assert.deepStrictEqual(yield* audit(app, "category_created"), [
        ["category_created", "garden-notes"],
      ]);
    }),
  );
});

/** Five published posts by three authors, on two blogs. */
const seedFeed = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha");
  yield* app.createBlog("beta");
  const ana = yield* app.editor("ana", "alpha", "beta");
  const zed = yield* app.editor("zed", "alpha", "beta");
  const gone = yield* app.editor("gone", "alpha", "beta");
  for (const [who, name] of [
    [ana, "Anna"],
    [zed, "Zed"],
    [gone, "Gone"],
  ] as const) {
    yield* app.sql(
      (sql) => sql`UPDATE users SET name = ${name} WHERE id = ${who.id}`,
    );
  }

  const specs = [
    // slug, blog, title, words, day published, day updated, author, categories, tags
    [
      "a",
      "alpha",
      "Delta",
      100,
      1,
      4,
      ana,
      { main: "Security", extra: [] },
      ["rust"],
    ],
    [
      "b",
      "alpha",
      "bravo",
      10,
      2,
      2,
      zed,
      { main: "Programming", extra: ["Security"] },
      [],
    ],
    [
      "c",
      "alpha",
      "Charlie",
      400,
      3,
      5,
      gone,
      { main: "Career", extra: [] },
      [],
    ],
    [
      "d",
      "beta",
      "Echo",
      250,
      4,
      1,
      ana,
      { main: "Programming", extra: ["Security", "Career"] },
      ["rust"],
    ],
    ["e", "beta", "alpha", 30, 5, 3, zed, { main: "Personal", extra: [] }, []],
  ] as const;
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  for (const [
    slug,
    blog,
    title,
    n,
    pub,
    upd,
    author,
    categories,
    tags,
  ] of specs) {
    const post = yield* app.createPost(
      author.cookie,
      blog,
      postInput(slug, { title, content: doc(words(n)), categories, tags }),
    );
    yield* app.publish(author.cookie, blog, post["id"]);
    yield* app.setPublishedAt(post["id"], day(pub));
    yield* app.sql(
      (sql) => sql`
        UPDATE blog_posts SET updated_at = ${day(10 + upd)}
        WHERE id = ${String(post["id"])}
      `,
    );
  }
  yield* app.expect(204, gone.cookie, "POST", "/account/delete");
  return { app, ana, zed, gone };
});

const order = {
  newest: ["e", "d", "c", "b", "a"],
  oldest: ["a", "b", "c", "d", "e"],
  updated: ["c", "a", "e", "b", "d"],
  title: ["e", "b", "c", "a", "d"],
  readingTime: ["b", "e", "a", "d", "c"],
  category: ["c", "e", "d", "b", "a"],
  author: ["d", "a", "e", "b", "c"],
} as const;

describe("post feed sorting", () => {
  it.effect("orders both feeds and pages through every order", () =>
    Effect.gen(function* () {
      const { app } = yield* seedFeed;
      const scopes: ReadonlyArray<
        readonly [string, (slug: string) => boolean]
      > = [
        ["/posts", () => true],
        ["/blogs/alpha/posts", (s) => ["a", "b", "c"].includes(s)],
      ];
      for (const [path, keep] of scopes) {
        for (const [sort, full] of Object.entries(order)) {
          const expected = full.filter(keep);
          const first = yield* app.expect(
            200,
            undefined,
            "GET",
            `${path}?sort=${sort}`,
          );
          assert.deepStrictEqual(
            slugs(list(first["posts"])),
            expected,
            `${path} sort=${sort}`,
          );
          assert.isNull(first["nextCursor"]);

          const walked: Array<unknown> = [];
          let cursor: unknown = null;
          for (let page = 0; page < 10; page++) {
            const query: string =
              `${path}?sort=${sort}&limit=2` +
              (cursor === null
                ? ""
                : `&cursor=${encodeURIComponent(String(cursor))}`);
            const body: Json = yield* app.expect(200, undefined, "GET", query);
            const posts = list(body["posts"]);
            assert.isAtMost(posts.length, 2);
            walked.push(...slugs(posts));
            cursor = body["nextCursor"];
            if (cursor === null) break;
            assert.isAbove(posts.length, 0);
          }
          assert.isNull(cursor, `${path} sort=${sort} ends`);
          assert.deepStrictEqual(
            walked,
            expected,
            `${path} sort=${sort} paged`,
          );
        }
      }
    }),
  );

  it.effect("defaults to newest and shows deleted authors as unnamed", () =>
    Effect.gen(function* () {
      const { app, ana } = yield* seedFeed;
      const body = yield* app.expect(200, undefined, "GET", "/posts");
      const posts = list(body["posts"]);
      assert.deepStrictEqual(slugs(posts), [...order.newest]);
      const c = posts.find((p) => p["slug"] === "c");
      assert.deepStrictEqual(c?.["author"], { id: null, name: null });
      const d = posts.find((p) => p["slug"] === "d");
      assert.deepStrictEqual(d?.["author"], { id: ana.id, name: "Anna" });
      assert.deepStrictEqual(d?.["categories"], {
        main: ref("programming", "Programming"),
        extra: [ref("career", "Career"), ref("security", "Security")],
      });
    }),
  );

  it.effect("refuses a cursor of another sort and garbage cursors", () =>
    Effect.gen(function* () {
      const { app } = yield* seedFeed;
      const page = yield* app.expect(
        200,
        undefined,
        "GET",
        "/posts?sort=title&limit=2",
      );
      const cursor = encodeURIComponent(String(page["nextCursor"]));
      for (const sort of Object.keys(order)) {
        const response = yield* app.call(
          undefined,
          "GET",
          `/posts?sort=${sort}&cursor=${cursor}`,
        );
        assert.strictEqual(response.status, sort === "title" ? 200 : 400, sort);
        const blogResponse = yield* app.call(
          undefined,
          "GET",
          `/blogs/alpha/posts?sort=${sort}&cursor=${cursor}`,
        );
        assert.strictEqual(
          blogResponse.status,
          sort === "title" ? 200 : 400,
          sort,
        );
      }
      const garbage = [
        "garbage",
        "!!!",
        Buffer.from("[]").toString("base64url"),
        Buffer.from('["x",1,"y"]').toString("base64url"),
        Buffer.from("not json").toString("base64url"),
        "A".repeat(5000),
      ];
      for (const value of garbage) {
        const response = yield* app.call(
          undefined,
          "GET",
          `/posts?cursor=${encodeURIComponent(value)}`,
        );
        assert.strictEqual(response.status, 400, value.slice(0, 20));
      }
      for (const query of ["sort=random", "limit=0", "limit=51"]) {
        const response = yield* app.call(undefined, "GET", `/posts?${query}`);
        assert.strictEqual(response.status, 400, query);
      }
    }),
  );
});

describe("post feed filters", () => {
  it.effect("filters by category, author and tag", () =>
    Effect.gen(function* () {
      const { app, ana, zed, gone } = yield* seedFeed;
      const get = (query: string) =>
        app
          .expect(200, undefined, "GET", `/posts?${query}`)
          .pipe(Effect.map((body) => slugs(list(body["posts"]))));

      // Main or extra.
      assert.deepStrictEqual(yield* get("category=security"), ["d", "b", "a"]);
      assert.deepStrictEqual(yield* get("category=career"), ["d", "c"]);
      assert.deepStrictEqual(yield* get("category=programming"), ["d", "b"]);
      assert.deepStrictEqual(yield* get("category=open-source"), []);
      assert.deepStrictEqual(yield* get("category=nope"), []);

      assert.deepStrictEqual(yield* get(`author=${ana.id}`), ["d", "a"]);
      assert.deepStrictEqual(yield* get(`author=${zed.id}`), ["e", "b"]);
      // A deleted author lists nothing.
      assert.deepStrictEqual(yield* get(`author=${gone.id}`), []);

      // Combined.
      assert.deepStrictEqual(yield* get("category=security&tag=rust"), [
        "d",
        "a",
      ]);
      assert.deepStrictEqual(yield* get("category=career&tag=rust"), ["d"]);
      assert.deepStrictEqual(yield* get(`category=security&author=${zed.id}`), [
        "b",
      ]);
      assert.deepStrictEqual(
        yield* get(`category=career&author=${ana.id}&tag=rust`),
        ["d"],
      );
      assert.deepStrictEqual(yield* get(`author=${zed.id}&tag=rust`), []);
      // Filters keep sort and paging working.
      const page = yield* app.expect(
        200,
        undefined,
        "GET",
        "/posts?category=security&sort=oldest&limit=2",
      );
      assert.deepStrictEqual(slugs(list(page["posts"])), ["a", "b"]);
      const next = yield* app.expect(
        200,
        undefined,
        "GET",
        `/posts?category=security&sort=oldest&limit=2&cursor=${encodeURIComponent(String(page["nextCursor"]))}`,
      );
      assert.deepStrictEqual(slugs(list(next["posts"])), ["d"]);
      assert.isNull(next["nextCursor"]);

      // The same on one blog.
      const alpha = yield* app.expect(
        200,
        undefined,
        "GET",
        `/blogs/alpha/posts?category=security&author=${zed.id}`,
      );
      assert.deepStrictEqual(slugs(list(alpha["posts"])), ["b"]);
      const none = yield* app.expect(
        200,
        undefined,
        "GET",
        `/blogs/beta/posts?category=security&author=${zed.id}`,
      );
      assert.deepStrictEqual(list(none["posts"]), []);
    }),
  );

  it.effect("rejects malformed filters", () =>
    Effect.gen(function* () {
      const { app } = yield* seedFeed;
      for (const query of ["category=Not%20a%20slug", "author=not-an-id"]) {
        const response = yield* app.call(undefined, "GET", `/posts?${query}`);
        assert.strictEqual(response.status, 400, query);
      }
    }),
  );
});

describe("category administration", () => {
  const forbidden = (app: App, editorCookie: string) =>
    Effect.gen(function* () {
      const requests: ReadonlyArray<readonly [string, string, unknown?]> = [
        ["PATCH", "/admin/categories/career", { name: "Jobs" }],
        ["POST", "/admin/categories/career/merge", { into: "personal" }],
        ["DELETE", "/admin/categories/career"],
      ];
      for (const [method, path, body] of requests) {
        for (const cookie of [editorCookie, app.user.cookie]) {
          const response = yield* app.call(cookie, method, path, { body });
          assert.strictEqual(response.status, 403, `${method} ${path}`);
        }
        const anonymous = yield* app.call(undefined, method, path, { body });
        assert.strictEqual(anonymous.status, 401, `${method} ${path}`);
      }
    });

  it.effect("renames a category, changing its slug", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* adminBlog(app, "alpha", "Security");
      yield* forbidden(app, (yield* app.editor("ed2", "alpha")).cookie);
      const renamed = yield* app.expect(
        200,
        app.admin.cookie,
        "PATCH",
        "/admin/categories/security",
        { body: { name: "Cyber Security" } },
      );
      assert.deepStrictEqual(renamed, {
        slug: "cyber-security",
        name: "Cyber Security",
        blogCount: 1,
        postCount: 0,
      });
      const blog = yield* app.expect(200, undefined, "GET", "/blogs/alpha");
      assert.deepStrictEqual(
        (blog["categories"] as Json)["main"],
        ref("cyber-security", "Cyber Security"),
      );
      const all = yield* categoriesOf(app);
      assert.isUndefined(bySlug(all, "security"));
      assert.strictEqual(
        bySlug(all, "cyber-security")?.["name"],
        "Cyber Security",
      );

      // Only the name changes when the slug stays.
      const recased = yield* app.expect(
        200,
        app.admin.cookie,
        "PATCH",
        "/admin/categories/career",
        { body: { name: "CAREER" } },
      );
      assert.strictEqual(recased["slug"], "career");
      assert.strictEqual(recased["name"], "CAREER");

      assert.deepStrictEqual(yield* audit(app, "category_renamed"), [
        ["category_renamed", "cyber-security"],
        ["category_renamed", "career"],
      ]);
    }),
  );

  it.effect("refuses a taken name, an unknown category and a bad name", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      const taken = yield* app.expect(
        409,
        app.admin.cookie,
        "PATCH",
        "/admin/categories/career",
        { body: { name: "Open  Source" } },
      );
      assert.deepStrictEqual(taken, {
        _tag: "CategoryNameTaken",
        category: "open-source",
      });
      const missing = yield* app.expect(
        404,
        app.admin.cookie,
        "PATCH",
        "/admin/categories/nope",
        { body: { name: "Anything" } },
      );
      assert.deepStrictEqual(missing, {
        _tag: "CategoryNotFound",
        category: "nope",
      });
      const bad = yield* app.call(
        app.admin.cookie,
        "PATCH",
        "/admin/categories/career",
        { body: { name: "!!!" } },
      );
      assert.strictEqual(bad.status, 400);
      assert.strictEqual(
        bySlug(yield* categoriesOf(app), "career")?.["name"],
        "Career",
      );
      assert.lengthOf(yield* audit(app, "category_renamed"), 0);
    }),
  );

  it.effect("merges a category into another", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* adminBlog(app, "alpha", "Career", ["Security"]);
      yield* adminBlog(app, "beta", "Programming", ["Career"]);
      const ed = yield* app.editor("ed", "alpha");
      const make = (
        slug: string,
        main: string,
        extra: ReadonlyArray<string>,
        publish = true,
      ) =>
        Effect.gen(function* () {
          const post = yield* app.createPost(
            ed.cookie,
            "alpha",
            postInput(slug, { categories: { main, extra } }),
          );
          if (publish) yield* app.publish(ed.cookie, "alpha", post["id"]);
          return post;
        });
      const mainAndTarget = yield* make("main-and-target", "Career", [
        "Security",
      ]);
      const bothExtra = yield* make("both-extra", "Programming", [
        "Career",
        "Security",
      ]);
      const onlySource = yield* make("only-source", "Programming", ["Career"]);
      const draft = yield* make("draft", "Career", [], false);
      yield* forbidden(app, ed.cookie);

      const merged = yield* app.expect(
        200,
        app.admin.cookie,
        "POST",
        "/admin/categories/career/merge",
        { body: { into: "security" } },
      );
      assert.deepStrictEqual(merged, {
        slug: "security",
        name: "Security",
        blogCount: 2, // alpha (main), beta (extra)
        postCount: 3,
      });
      const all = yield* categoriesOf(app);
      assert.isUndefined(bySlug(all, "career"));

      const categoriesOfPost = (post: Json) =>
        app
          .expect(
            200,
            ed.cookie,
            "GET",
            `/blogs/alpha/manage/posts/${String(post["id"])}`,
          )
          .pipe(Effect.map((p) => p["categories"]));
      const security = ref("security", "Security");
      const programming = ref("programming", "Programming");
      assert.deepStrictEqual(yield* categoriesOfPost(mainAndTarget), {
        main: security,
        extra: [],
      });
      assert.deepStrictEqual(yield* categoriesOfPost(bothExtra), {
        main: programming,
        extra: [security],
      });
      assert.deepStrictEqual(yield* categoriesOfPost(onlySource), {
        main: programming,
        extra: [security],
      });
      assert.deepStrictEqual(yield* categoriesOfPost(draft), {
        main: security,
        extra: [],
      });
      const alpha = yield* app.expect(200, undefined, "GET", "/blogs/alpha");
      assert.deepStrictEqual(alpha["categories"], {
        main: security,
        extra: [],
      });
      const beta = yield* app.expect(200, undefined, "GET", "/blogs/beta");
      assert.deepStrictEqual(beta["categories"], {
        main: programming,
        extra: [security],
      });

      // Gone now.
      const again = yield* app.expect(
        404,
        app.admin.cookie,
        "POST",
        "/admin/categories/career/merge",
        { body: { into: "security" } },
      );
      assert.deepStrictEqual(again, {
        _tag: "CategoryNotFound",
        category: "career",
      });
      assert.deepStrictEqual(yield* audit(app, "category_merged"), [
        ["category_merged", "career"],
      ]);
    }),
  );

  it.effect("refuses to merge into itself or into an unknown category", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      const self = yield* app.expect(
        409,
        app.admin.cookie,
        "POST",
        "/admin/categories/career/merge",
        { body: { into: "career" } },
      );
      assert.deepStrictEqual(self, {
        _tag: "CategoryMergeIntoSelf",
        category: "career",
      });
      const unknown = yield* app.expect(
        404,
        app.admin.cookie,
        "POST",
        "/admin/categories/career/merge",
        { body: { into: "nope" } },
      );
      assert.deepStrictEqual(unknown, {
        _tag: "CategoryNotFound",
        category: "nope",
      });
      assert.isDefined(bySlug(yield* categoriesOf(app), "career"));
      assert.lengthOf(yield* audit(app, "category_merged"), 0);
    }),
  );

  it.effect("deletes only categories that are not used", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha"); // Programming
      const ed = yield* app.editor("ed", "alpha");
      // Only a draft uses Open Source.
      yield* app.createPost(
        ed.cookie,
        "alpha",
        postInput("draft", { categories: { main: "Open Source", extra: [] } }),
      );

      const byBlog = yield* app.expect(
        409,
        app.admin.cookie,
        "DELETE",
        "/admin/categories/programming",
      );
      assert.deepStrictEqual(byBlog, {
        _tag: "CategoryInUse",
        blogCount: 1,
        postCount: 0,
      });
      const byDraft = yield* app.expect(
        409,
        app.admin.cookie,
        "DELETE",
        "/admin/categories/open-source",
      );
      assert.deepStrictEqual(byDraft, {
        _tag: "CategoryInUse",
        blogCount: 0,
        postCount: 1,
      });
      assert.lengthOf(yield* audit(app, "category_deleted"), 0);

      const missing = yield* app.expect(
        404,
        app.admin.cookie,
        "DELETE",
        "/admin/categories/nope",
      );
      assert.deepStrictEqual(missing, {
        _tag: "CategoryNotFound",
        category: "nope",
      });

      yield* app.expect(
        204,
        app.admin.cookie,
        "DELETE",
        "/admin/categories/personal",
      );
      const all = yield* categoriesOf(app);
      assert.isUndefined(bySlug(all, "personal"));
      assert.strictEqual(all.length, PresetCategories.length - 1);
      yield* app.expect(
        404,
        app.admin.cookie,
        "DELETE",
        "/admin/categories/personal",
      );
      assert.deepStrictEqual(yield* audit(app, "category_deleted"), [
        ["category_deleted", "personal"],
      ]);
    }),
  );
});
