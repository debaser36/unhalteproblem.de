// The blogs, media and blog editor groups: their OpenAPI document,
// middlewares, and an encoding round trip through the in-memory client.
import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import {
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiMiddleware,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import { Api } from "#Api";
import { Authentication, CurrentUser, SessionCookie } from "#Authentication";
import { RequireBlogEditor } from "#Authorization";
import {
  type ManagedPost,
  PostId,
  PostPageLimits,
  type PublishedPost,
} from "#domain/Blog";
import { emptyDocument } from "#domain/Document";
import { MediaId } from "#domain/Media";
import { Forbidden } from "#errors/Forbidden";
import { PostNotFound } from "#errors/PostNotFound";
import { Unauthorized } from "#errors/Unauthorized";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";
import { RequireBlogRequestModerator } from "./BlogRequestAdmin.ts";
import { RequireFoodPlanner } from "./Food.ts";
import { BlogEditorGroup } from "./BlogEditor.ts";

describe("blog endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "put" | "delete";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();
  const posts = "/blogs/{blog}/manage/posts";
  const post = "/blogs/{blog}/manage/posts/{postId}";

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/blogs", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/blogs/{blog}", "get"), ["200", "404"]);
    assert.deepStrictEqual(statuses("/blogs/{blog}/posts", "get"), [
      "200",
      "404",
    ]);
    assert.deepStrictEqual(statuses("/blogs/{blog}/posts/{post}", "get"), [
      "200",
      "404",
    ]);
    assert.deepStrictEqual(statuses("/posts", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/categories", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/blogs/{blog}/manage/categories", "put"), [
      "200",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(statuses("/media/{mediaId}", "get"), ["200", "404"]);
    assert.deepStrictEqual(statuses(posts, "get"), ["200", "401", "403"]);
    assert.deepStrictEqual(statuses(posts, "post"), [
      "201",
      "401",
      "403",
      "404",
      "409",
    ]);
    assert.deepStrictEqual(statuses(post, "get"), ["200", "401", "403", "404"]);
    assert.deepStrictEqual(statuses(post, "put"), [
      "200",
      "401",
      "403",
      "404",
      "409",
    ]);
    assert.deepStrictEqual(statuses(post, "delete"), [
      "204",
      "401",
      "403",
      "404",
    ]);
    for (const action of ["publish", "unpublish"]) {
      assert.deepStrictEqual(statuses(`${post}/${action}`, "post"), [
        "200",
        "401",
        "403",
        "404",
      ]);
    }
    assert.deepStrictEqual(statuses("/blogs/{blog}/manage/media", "post"), [
      "201",
      "400",
      "401",
      "403",
      "413",
      "415",
    ]);
  });

  it("keeps the blogs and media public and the editor endpoints behind the session", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      const editor = path.includes("/manage/");
      const public_ =
        path === "/posts" ||
        path.startsWith("/media/") ||
        (path.startsWith("/blogs") && !editor);
      if (!editor && !public_) continue;
      for (const op of Object.values(item ?? {})) {
        assert.deepStrictEqual(
          (op as { security?: unknown }).security,
          editor ? [{ session: [] }] : [],
          path,
        );
      }
    }
  });

  it("returns one ManagedPost component with 201 and 200", () => {
    const created = operation(posts, "post")?.responses["201"]?.content?.[
      "application/json"
    ]?.schema as { readonly anyOf?: ReadonlyArray<unknown> };
    assert.deepStrictEqual(created.anyOf, [
      { $ref: "#/components/schemas/ManagedPost" },
    ]);
    assert.deepStrictEqual(
      operation(post, "put")?.responses["200"]?.content?.["application/json"]
        ?.schema,
      { $ref: "#/components/schemas/ManagedPost" },
    );
    assert.isFalse(
      Object.keys(spec.components.schemas).some((name) => /_\d+$/.test(name)),
    );
  });

  it("documents the recursive document", () => {
    assert.containsAllKeys(spec.components.schemas, [
      "Document",
      "DocumentNode",
      "ParagraphNode",
      "TextNode",
      "LinkMark",
    ]);
    const paragraph = spec.components.schemas["ParagraphNode"] as {
      readonly properties: Record<string, unknown>;
    };
    assert.deepStrictEqual(paragraph.properties["content"], {
      type: "array",
      items: { $ref: "#/components/schemas/DocumentNode" },
    });
  });

  it("takes the upload as multipart and serves images as bytes", () => {
    assert.deepStrictEqual(
      Object.keys(
        operation("/blogs/{blog}/manage/media", "post")?.requestBody?.content ??
          {},
      ),
      ["multipart/form-data"],
    );
    assert.deepStrictEqual(
      Object.keys(
        operation("/media/{mediaId}", "get")?.responses["200"]?.content ?? {},
      ),
      ["application/octet-stream"],
    );
  });

  it("documents limit, sort, cursor and the filters as optional query parameters", () => {
    for (const path of ["/posts", "/blogs/{blog}/posts"]) {
      const query = (operation(path, "get")?.parameters ?? []).filter(
        (parameter) => parameter.in === "query",
      );
      assert.deepStrictEqual(
        query.map(({ name, required }) => ({ name, required })),
        [
          { name: "limit", required: false },
          { name: "sort", required: false },
          { name: "cursor", required: false },
          { name: "tag", required: false },
          { name: "category", required: false },
          { name: "author", required: false },
        ],
      );
    }
  });
});

describe("blog endpoint middleware", () => {
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
  const withKey = (key: string) =>
    [...middlewares]
      .filter(([, keys]) => keys.includes(key))
      .map(([name]) => name)
      .sort();

  it("needs no middleware on the public groups", () => {
    for (const [name, keys] of middlewares) {
      if (name.startsWith("blogs.") || name.startsWith("media.")) {
        assert.deepStrictEqual(keys, [], name);
      }
    }
  });

  it("authenticates every editor endpoint and checks the origin of writes", () => {
    const writes = [
      "blogEditor.createPost",
      "blogEditor.updatePost",
      "blogEditor.publishPost",
      "blogEditor.unpublishPost",
      "blogEditor.deletePost",
      "blogEditor.setBlogCategories",
      "blogEditor.uploadMedia",
    ];
    for (const [name, keys] of middlewares) {
      if (!name.startsWith("blogEditor.")) continue;
      assert.isTrue(keys.includes(Authentication.key), name);
      assert.strictEqual(
        keys.includes(SameOrigin.key),
        writes.includes(name),
        name,
      );
    }
  });

  // The project endpoints are checked in `groups/Projects.test.ts`.
  it("raises the body limit exactly for whole posts", () => {
    const blogEndpoints = withKey(LargeBody.key).filter(
      (name) =>
        !name.startsWith("projectAdmin.") &&
        !name.startsWith("paymentWebhooks."),
    );
    assert.deepStrictEqual(blogEndpoints, [
      "blogEditor.createPost",
      "blogEditor.updatePost",
    ]);
    assert.isFalse(LargeBody.requiredForClient);
    assert.deepStrictEqual([...LargeBody.error], []);
  });

  it("checks the editor role of every editor endpoint before its body", () => {
    // `endpoint.middlewares` is in insertion order, inner first; the
    // builder wraps the handler in that order, so the last one runs first.
    const runtimeOrder = Object.values(BlogEditorGroup.endpoints).map(
      (endpoint) => ({
        name: endpoint.identifier,
        keys: [...endpoint.middlewares].map((m) => m.key).reverse(),
      }),
    );
    const expected = (keys: Array<string>) => [
      Authentication.key,
      RequireBlogEditor.key,
      ...keys,
    ];
    for (const { name, keys } of runtimeOrder) {
      switch (name) {
        case "listManagedPosts":
        case "getManagedPost":
          assert.deepStrictEqual(keys, expected([]), name);
          break;
        case "createPost":
        case "updatePost":
          assert.deepStrictEqual(
            keys,
            expected([SameOrigin.key, LargeBody.key]),
            name,
          );
          break;
        default:
          assert.deepStrictEqual(keys, expected([SameOrigin.key]), name);
      }
    }
    assert.strictEqual(runtimeOrder.length, 9);
  });

  it("RequireBlogEditor fails with Forbidden and needs no client middleware", () => {
    assert.deepStrictEqual([...RequireBlogEditor.error], [Forbidden]);
    assert.isFalse(RequireBlogEditor.requiredForClient);
    assert.isFalse("security" in RequireBlogEditor);
  });
});

// Stub handlers and middleware, only to exercise the contract's encoding and
// decoding through the in-memory client. Real implementations live in the
// backend.

const postId = PostId.make("8d7e6f5a-4b3c-4d2e-8f1a-0b9c8d7e6f5a");
const coverId = MediaId.make("3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60");
const t0 = DateTime.makeUnsafe("2026-03-01T12:00:00Z");
const site = "https://unhalteproblem.de";
const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const miscellaneous = { slug: "miscellaneous", name: "Miscellaneous" };
const categories = { main: miscellaneous, extra: [] };
const publishedPost: PublishedPost = {
  id: postId,
  blog: "rust-notes",
  slug: "hello-world",
  title: "Hello, world",
  summary: "The first post.",
  tags: ["rust"],
  coverImage: coverId,
  publishedAt: t0,
  updatedAt: t0,
  author: { id: null, name: "Ada" },
  readingMinutes: 1,
  categories,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Hello",
            marks: [{ type: "link", attrs: { href: "/", class: null } }],
          },
        ],
      },
    ],
  },
};

const BlogsHandlers = HttpApiBuilder.group(Api, "blogs", (handlers) =>
  handlers
    .handle("listBlogs", () => Effect.succeed([]))
    .handle("listCategories", () => Effect.succeed([]))
    .handle("getBlog", () => Effect.die("not used"))
    .handle("listPosts", () => Effect.die("not used"))
    .handle("getPost", ({ params }) =>
      params.post === publishedPost.slug
        ? Effect.succeed(publishedPost)
        : Effect.fail(new PostNotFound({ post: params.post })),
    )
    .handle("recentPosts", ({ query }) =>
      Effect.succeed({
        posts: query.limit > 0 ? [publishedPost] : [],
        nextCursor: { sort: "newest" as const, publishedAt: t0, id: postId },
      }),
    ),
);

const MediaHandlers = HttpApiBuilder.group(Api, "media", (handlers) =>
  handlers.handle("getMedia", () =>
    Effect.succeed(
      HttpServerResponse.uint8Array(imageBytes, { contentType: "image/png" }),
    ),
  ),
);

const BlogEditorHandlers = HttpApiBuilder.group(Api, "blogEditor", (handlers) =>
  handlers
    .handle("listManagedPosts", () => Effect.succeed([]))
    .handle("getManagedPost", () => Effect.die("not used"))
    .handle("createPost", ({ params, payload }) =>
      Effect.succeed({
        ...payload,
        categories,
        id: postId,
        blog: params.blog,
        status: "draft" as const,
        publishedAt: null,
        createdAt: t0,
        updatedAt: t0,
        version: 1,
        author: { id: null, name: "Ada" },
      } satisfies ManagedPost),
    )
    .handle("updatePost", () => Effect.die("not used"))
    .handle("publishPost", () => Effect.die("not used"))
    .handle("unpublishPost", () => Effect.die("not used"))
    .handle("deletePost", () => Effect.die("not used"))
    .handle("setBlogCategories", () => Effect.die("not used"))
    .handle("uploadMedia", () => Effect.die("not used")),
);

const AuthenticationStub = Layer.succeed(Authentication, {
  session: (httpEffect, { credential }) =>
    Redacted.value(credential) === "editor"
      ? Effect.provideService(httpEffect, CurrentUser, {
          user: { id: "editor", roles: ["blogEditor:rust-notes"] },
          expiresAt: t0,
        })
      : Effect.fail(new Unauthorized()),
});

// The documented implementation: the raw `blog` parameter of the route
// (the parameters are not decoded yet) against the user's roles.
const RequireBlogEditorStub = Layer.succeed(RequireBlogEditor, (httpEffect) =>
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext;
    const { user } = yield* CurrentUser;
    const blog = params["blog"];
    if (
      blog === undefined ||
      !user.roles.some((r) => r === `blogEditor:${blog}`)
    ) {
      return yield* new Forbidden();
    }
    return yield* httpEffect;
  }),
);

const unusedMiddleware = Effect.die("not used by these groups");

const asEditor = Layer.mergeAll(
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(
      HttpClientRequest.setHeader(request, "cookie", `${SessionCookie}=editor`),
    ),
  ),
  HttpApiMiddleware.layerClient(SameOrigin, ({ next, request }) =>
    next(HttpClientRequest.setHeader(request, "origin", site)),
  ),
);

const makeClient = HttpApiTest.groups(Api, ["blogs", "media", "blogEditor"]);

layer(
  Layer.mergeAll(
    Layer.mergeAll(BlogsHandlers, MediaHandlers, BlogEditorHandlers).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          AuthenticationStub,
          // Pass-through: the stubs check nothing.
          Layer.succeed(SameOrigin, (httpEffect) => httpEffect),
          Layer.succeed(LargeBody, (httpEffect) => httpEffect),
          RequireBlogEditorStub,
          Layer.succeed(RequireAdmin, () => unusedMiddleware),
          Layer.succeed(RequireSuperAdmin, () => unusedMiddleware),
          Layer.succeed(RequireFoodPlanner, () =>
            Effect.die("not used by this group"),
          ),
          Layer.succeed(RequireBlogRequestModerator, () => unusedMiddleware),
        ),
      ),
    ),
    HttpServer.layerServices,
  ),
)("blog client round trip", (it) => {
  it.effect("getPost returns the post with its document", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.blogs.getPost({
        params: { blog: "rust-notes", post: "hello-world" },
        responseMode: "response-only",
      });
      const body = (yield* response.json) as Record<string, unknown>;
      assert.strictEqual(body["publishedAt"], "2026-03-01T12:00:00.000Z");
      assert.deepStrictEqual(body["content"], publishedPost.content);

      assert.deepStrictEqual(
        yield* client.blogs.getPost({
          params: { blog: "rust-notes", post: "hello-world" },
        }),
        publishedPost,
      );
      assert.deepStrictEqual(
        yield* client.blogs
          .getPost({ params: { blog: "rust-notes", post: "missing" } })
          .pipe(Effect.flip),
        new PostNotFound({ post: "missing" }),
      );
    }),
  );

  it.effect("recentPosts passes the cursor as an opaque string", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const page = yield* client.blogs.recentPosts({
        query: { limit: PostPageLimits.defaultLimit, sort: "newest" },
      });
      assert.deepStrictEqual(page.nextCursor, {
        sort: "newest",
        publishedAt: t0,
        id: postId,
      });
      // Encoded as a `PostListItem`: the content is not part of lists.
      const { content: _, ...listItem } = publishedPost;
      assert.deepStrictEqual(page.posts, [listItem]);
    }),
  );

  it.effect("getMedia returns the raw bytes with the stored type", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.media.getMedia({
        params: { mediaId: coverId },
        responseMode: "response-only",
      });
      assert.strictEqual(response.headers["content-type"], "image/png");
      assert.deepStrictEqual(
        yield* client.media.getMedia({ params: { mediaId: coverId } }),
        imageBytes,
      );
    }),
  );

  it.effect("createPost answers 201 with the draft", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const payload = {
        slug: "next",
        title: "Next",
        summary: "",
        tags: [],
        coverImage: null,
        categories: { main: "Programming", extra: [] },
        content: emptyDocument,
      };
      const response = yield* client.blogEditor.createPost({
        params: { blog: "rust-notes" },
        payload,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 201);
      const created = yield* client.blogEditor.createPost({
        params: { blog: "rust-notes" },
        payload,
      });
      assert.strictEqual(created.status, "draft");
      assert.deepStrictEqual(created.content, emptyDocument);
    }).pipe(Effect.provide(asEditor)),
  );

  it.effect("the editor endpoints answer 403 for another subblog", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.blogEditor
        .createPost({
          params: { blog: "go-notes" },
          payload: {
            slug: "next",
            title: "Next",
            summary: "",
            tags: [],
            coverImage: null,
            categories: { main: "Programming", extra: [] },
            content: emptyDocument,
          },
        })
        .pipe(Effect.flip);
      assert.instanceOf(error, Forbidden);
    }).pipe(Effect.provide(asEditor)),
  );

  it.effect("the editor endpoints answer 401 without a session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.blogEditor
        .listManagedPosts({ params: { blog: "rust-notes" } })
        .pipe(Effect.flip);
      assert.instanceOf(error, Unauthorized);
    }),
  );
});
