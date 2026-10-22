import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { doc, json, makeBlogApp, postInput } from "#testing/Blogs";

const origin = "https://unhalteproblem.de";

const projectInput = (slug: string, published: boolean) => ({
  slug,
  title: `Title of ${slug}`,
  summary: `Summary of ${slug}`,
  tags: [],
  status: "active",
  featured: false,
  position: 0,
  repoUrl: "https://github.com/debaser36/example",
  liveUrl: null,
  coverImage: null,
  content: doc("project text"),
  published,
});

const assertLockedDown = (response: Response) => {
  assert.strictEqual(
    response.headers.get("content-security-policy"),
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  );
  assert.strictEqual(response.headers.get("x-content-type-options"), "nosniff");
  assert.strictEqual(
    response.headers.get("cache-control"),
    "public, max-age=300",
  );
};

/** Subblog `alpha` with a published post, a draft and two projects. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha");
  const editor = yield* app.editor("ed", "alpha");
  const hostile = '<img src=x onerror=alert(1)> & "quotes"';
  const post = yield* app.createPost(
    editor.cookie,
    "alpha",
    postInput("hello", {
      title: hostile,
      summary: "A summary",
      tags: ["effect"],
      content: doc("Body text <script>alert(1)</script>"),
    }),
  );
  yield* app.publish(editor.cookie, "alpha", post["id"]);
  yield* app.createPost(editor.cookie, "alpha", postInput("secret-draft"));
  yield* app.expect(201, app.admin.cookie, "POST", "/admin/projects", {
    body: projectInput("shown", true),
  });
  yield* app.expect(201, app.admin.cookie, "POST", "/admin/projects", {
    body: projectInput("hidden", false),
  });
  /** A public request: no cookie, no origin. */
  const get = (path: string) =>
    app.call(undefined, "GET", path, { origin: null });
  const text = (path: string) =>
    get(path).pipe(
      Effect.flatMap((response) =>
        Effect.promise(() => response.text()).pipe(
          Effect.map((body) => ({ response, body })),
        ),
      ),
    );
  return { ...app, get, text, hostile };
});

describe("crawler pages", () => {
  it.effect(
    "renders the fixed pages for anyone, with locked-down headers",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        for (const page of ["home", "about", "contact", "blog", "projects"]) {
          const { response, body } = yield* app.text(`/seo/pages/${page}`);
          assert.strictEqual(response.status, 200, page);
          assert.match(
            response.headers.get("content-type") ?? "",
            /^text\/html/,
          );
          assert.strictEqual(
            response.headers.get("content-security-policy"),
            "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          );
          assert.strictEqual(
            response.headers.get("x-content-type-options"),
            "nosniff",
          );
          assert.match(body, /<h1>/);
          assert.match(
            body,
            /<link rel="canonical" href="https:\/\/unhalteproblem\.de\//,
          );
        }
        const home = (yield* app.text("/seo/pages/home")).body;
        assert.include(home, "&lt;img src=x onerror=alert(1)&gt;");
        assert.include(home, '"@type":"WebSite"');
        assert.strictEqual((yield* app.get("/seo/pages/nope")).status, 400);
      }),
  );

  it.effect("renders a published post with escaped content", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { response, body } = yield* app.text(
        "/seo/blogs/alpha/posts/hello",
      );
      assert.strictEqual(response.status, 200);
      assert.include(
        body,
        `<link rel="canonical" href="${origin}/blog/alpha/hello">`,
      );
      assert.include(body, '<meta property="og:type" content="article">');
      assertLockedDown(response);
      assert.include(body, '"@type":"BlogPosting"');
      // The hostile title is in the JSON-LD, with every `<` escaped.
      const jsonLd = [
        ...body.matchAll(
          /<script type="application\/ld\+json">(.*?)<\/script>/g,
        ),
      ];
      assert.strictEqual(jsonLd.length, 2);
      for (const [, json] of jsonLd) assert.notInclude(json ?? "", "<");
      assert.include(
        jsonLd[0]?.[1] ?? "",
        "\\u003cimg src=x onerror=alert(1)>",
      );
      assert.include(body, "Body text &lt;script&gt;alert(1)&lt;/script&gt;");
      assert.include(body, "A summary");
      // Nothing the author wrote became markup: the only scripts are JSON-LD.
      assert.notInclude(body, "<img src=x");
      assert.notInclude(body, "<script>alert");
      const scripts = body.match(/<script/g) ?? [];
      assert.strictEqual(scripts.length, 2);
      assert.strictEqual(
        (body.match(/<script type="application\/ld\+json">/g) ?? []).length,
        2,
      );
    }),
  );

  it.effect("answers 404 for drafts and unknown posts and blogs", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const draft = yield* app.get("/seo/blogs/alpha/posts/secret-draft");
      assert.strictEqual(draft.status, 404);
      assert.strictEqual((yield* json(draft))["_tag"], "PostNotFound");
      assert.strictEqual(
        (yield* app.get("/seo/blogs/alpha/posts/nope")).status,
        404,
      );
      const blog = yield* app.get("/seo/blogs/nope/posts/hello");
      assert.strictEqual(blog.status, 404);
      assert.strictEqual((yield* json(blog))["_tag"], "BlogNotFound");
      assert.strictEqual((yield* app.get("/seo/blogs/nope")).status, 404);
    }),
  );

  it.effect("renders a blog with its published posts only", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { response, body } = yield* app.text("/seo/blogs/alpha");
      assert.strictEqual(response.status, 200);
      assert.include(body, "Blog alpha");
      assert.include(body, 'href="/blog/alpha/hello"');
      assert.notInclude(body, "secret-draft");
      assert.include(body, '"@type":"BreadcrumbList"');
    }),
  );

  it.effect("renders published projects only", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const shown = yield* app.text("/seo/projects/shown");
      assert.strictEqual(shown.response.status, 200);
      assert.include(shown.body, "project text");
      assert.include(shown.body, '"@type":"SoftwareSourceCode"');
      assert.include(shown.body, "https://github.com/debaser36/example");
      const hidden = yield* app.get("/seo/projects/hidden");
      assert.strictEqual(hidden.status, 404);
      assert.strictEqual((yield* json(hidden))["_tag"], "ProjectNotFound");
      const index = (yield* app.text("/seo/pages/projects")).body;
      assert.include(index, 'href="/projects/shown"');
      assert.notInclude(index, "hidden");
    }),
  );

  it.effect("lists the fixed pages and published content in the sitemap", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { response, body } = yield* app.text("/sitemap.xml");
      assert.strictEqual(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^application\/xml/,
      );
      const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
      assert.deepStrictEqual(locs, [
        `${origin}/`,
        `${origin}/about`,
        `${origin}/contact`,
        `${origin}/blog`,
        `${origin}/projects`,
        `${origin}/blog/alpha`,
        `${origin}/projects/shown`,
        `${origin}/blog/alpha/hello`,
      ]);
      assertLockedDown(response);
      assert.match(body, /<lastmod>\d{4}-\d{2}-\d{2}T/);
    }),
  );
});
