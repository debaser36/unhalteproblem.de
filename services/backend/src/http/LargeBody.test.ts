import { assert, describe, it } from "@effect/vitest";
import { MediaLimits } from "@unhalteproblem.de/api";
import { Effect, Exit } from "effect";
import { doc, form, makeBlogApp, png, postInput } from "#testing/Blogs";

/** About `kib` KiB of document JSON: paragraphs of 1000 characters. */
const largeDocument = (kib: number) =>
  doc(
    ...Array.from({ length: kib }, (_, index) => `${index} `.padEnd(1000, "x")),
  );

/** `size` bytes starting with the PNG signature. */
const pngOfSize = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(png.subarray(0, 8));
  return bytes;
};

/**
 * Whether the server refused to read the request's body: the Node server
 * closes the connection of a body over its limit (`MaxBodySize`) without an
 * answer, so a client sees a reset, or a 413 if it was quicker.
 */
const refused = (response: Effect.Effect<Response>) =>
  Effect.map(Effect.exit(response), (exit) =>
    Exit.isSuccess(exit)
      ? exit.value.status === 413
      : String(Exit.isFailure(exit) && exit.cause).includes("ECONNRESET"),
  );

// Over a Node server with the production body limit of 32 KiB, which only
// the Node server enforces.
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp({ maxBodyKibibytes: 32 });
  yield* app.createBlog("alpha");
  const editor = yield* app.editor("ed", "alpha");
  const count = (table: "blog_posts" | "media") =>
    app
      .sql(
        (sql) => sql<{ readonly count: number }>`
          SELECT count(*)::int AS count FROM ${sql(table)}
        `,
      )
      .pipe(Effect.map((rows) => rows[0]?.count));
  return { ...app, editor, count };
});

describe("large bodies", () => {
  it.effect("a post of about 100 KB saves beyond the global 32 KiB limit", () =>
    Effect.gen(function* () {
      const { expect, editor } = yield* setup;
      const content = largeDocument(100);
      const input = postInput("long", { content });
      assert.isAbove(JSON.stringify(input).length, 100_000);

      const created = yield* expect(
        201,
        editor.cookie,
        "POST",
        "/blogs/alpha/manage/posts",
        { body: input },
      );
      assert.deepStrictEqual(created["content"], content);
      const longer = largeDocument(120);
      const updated = yield* expect(
        200,
        editor.cookie,
        "PUT",
        `/blogs/alpha/manage/posts/${String(created["id"])}`,
        { body: { ...postInput("long", { content: longer }), version: 1 } },
      );
      assert.deepStrictEqual(updated["content"], longer);
    }),
  );

  it.effect(
    "someone without the subblog's editor role gets 403 before the body is read",
    () =>
      Effect.gen(function* () {
        const app = yield* makeBlogApp({ maxBodyKibibytes: 32 });
        yield* app.createBlog("alpha");
        yield* app.createBlog("beta");
        // An editor, but of another subblog: logged in and same-origin,
        // which used to be enough to have a large body read and decoded.
        const other = yield* app.editor("other", "beta");
        const { expect } = app;
        yield* expect(403, other.cookie, "POST", "/blogs/alpha/manage/posts", {
          body: postInput("long", { content: largeDocument(100) }),
        });
        const posts = yield* app.sql(
          (sql) =>
            sql<{
              readonly count: number;
            }>`SELECT count(*)::int AS count FROM blog_posts`,
        );
        assert.strictEqual(posts[0]?.count, 0);
      }),
  );

  it.effect("the larger limit is for saving posts only", () =>
    Effect.gen(function* () {
      const { call, admin } = yield* setup;
      // Read, the body would be refused with 400 (the description is too
      // long); it isn't read at all.
      assert.isTrue(
        yield* refused(
          call(admin.cookie, "PATCH", "/admin/blogs/alpha", {
            body: { title: "Alpha", description: "x".repeat(100_000) },
          }),
        ),
      );
    }),
  );

  it.effect("a post above 512 KiB is refused", () =>
    Effect.gen(function* () {
      const { call, editor, count } = yield* setup;
      assert.isTrue(
        yield* refused(
          call(editor.cookie, "POST", "/blogs/alpha/manage/posts", {
            body: postInput("huge", { content: largeDocument(600) }),
          }),
        ),
      );
      assert.strictEqual(yield* count("blog_posts"), 0);
    }),
  );

  it.effect(
    "an image upload has its own limit of 5 MiB, and is never stored cut off",
    () =>
      Effect.gen(function* () {
        const { call, editor, count, sql } = yield* setup;
        const upload = (bytes: Uint8Array) =>
          call(editor.cookie, "POST", "/blogs/alpha/manage/media", {
            body: form(bytes),
          });
        // Several chunks of the request body: read while it is parsed.
        for (const size of [256 * 1024, 1024 * 1024]) {
          assert.strictEqual((yield* upload(pngOfSize(size))).status, 201);
        }
        const tooLarge = yield* upload(pngOfSize(MediaLimits.maxBytes + 1));
        assert.strictEqual(tooLarge.status, 413);
        assert.deepStrictEqual(yield* Effect.promise(() => tooLarge.json()), {
          _tag: "MediaTooLarge",
        });
        assert.strictEqual(yield* count("media"), 2);
        const sizes = yield* sql(
          (sql) => sql<{ readonly byteSize: number }>`
            SELECT byte_size FROM media ORDER BY byte_size
          `,
        );
        assert.deepStrictEqual(
          sizes.map(({ byteSize }) => byteSize),
          [256 * 1024, 1024 * 1024],
        );
      }),
    30_000,
  );
});
