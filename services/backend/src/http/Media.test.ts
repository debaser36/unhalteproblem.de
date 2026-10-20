import { assert, describe, it } from "@effect/vitest";
import { MediaLimits } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { form, makeBlogApp, png, postInput } from "#testing/Blogs";

/** An id no image has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

/** `size` bytes starting with the PNG signature. */
const pngOfSize = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(png.subarray(0, 8));
  return bytes;
};

/** Subblog `alpha` and its editor. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  yield* app.createBlog("alpha");
  const editor = yield* app.editor("ed", "alpha");
  const upload = (body: FormData) =>
    app.call(editor.cookie, "POST", "/blogs/alpha/manage/media", { body });
  const mediaCount = app
    .sql(
      (sql) => sql<{ readonly count: number }>`
      SELECT count(*)::int AS count FROM media
    `,
    )
    .pipe(Effect.map((rows) => rows[0]?.count));
  return { ...app, editor, upload, mediaCount };
});

describe("uploading and serving images", () => {
  it.effect("stores a PNG with 201 and serves its bytes", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      // The claimed type and file name don't matter, the content does.
      const response = yield* app.upload(form(png, { type: "text/html" }));
      assert.strictEqual(response.status, 201);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      const info = (yield* Effect.promise(() => response.json())) as Record<
        string,
        unknown
      >;
      const id = String(info["id"]);
      assert.deepInclude(info, {
        url: `/api/media/${id}`,
        contentType: "image/png",
        byteSize: png.length,
      });
      assert.isString(info["uploadedAt"]);

      const stored = yield* app.sql(
        (sql) =>
          sql<{
            readonly scope: string;
            readonly uploadedBy: string;
            readonly sha256: Uint8Array;
          }>`SELECT scope, uploaded_by, sha256 FROM media WHERE id = ${id}`,
      );
      assert.strictEqual(stored[0]?.scope, "blog:alpha");
      assert.strictEqual(stored[0]?.uploadedBy, app.editor.id);
      assert.deepStrictEqual(
        Buffer.from(stored[0]?.sha256 ?? []),
        createHash("sha256").update(png).digest(),
      );

      // Served to everyone, as nothing but the image, cacheable for good.
      const served = yield* app.call(undefined, "GET", `/media/${id}`, {
        origin: null,
      });
      assert.strictEqual(served.status, 200);
      assert.deepStrictEqual(
        new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
        png,
      );
      const headers = served.headers;
      assert.strictEqual(headers.get("content-type"), "image/png");
      assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
      assert.strictEqual(
        headers.get("content-security-policy"),
        "default-src 'none'; sandbox",
      );
      assert.strictEqual(
        headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assert.strictEqual(headers.get("content-disposition"), "inline");
      assert.strictEqual(
        headers.get("cross-origin-resource-policy"),
        "same-origin",
      );

      // An image can be a post's cover.
      const post = yield* app.createPost(
        app.editor.cookie,
        "alpha",
        postInput("covered", { coverImage: id }),
      );
      assert.strictEqual(post["coverImage"], id);
    }),
  );

  it.effect.each([
    ["SVG", svg],
    ["random bytes", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    ["a truncated PNG signature", png.subarray(0, 7)],
  ] as const)("refuses %s with 415 UnsupportedMedia", ([, bytes]) =>
    Effect.gen(function* () {
      const app = yield* setup;
      const response = yield* app.upload(form(bytes, { type: "image/png" }));
      assert.strictEqual(response.status, 415);
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        _tag: "UnsupportedMedia",
      });
      assert.strictEqual(yield* app.mediaCount, 0);
    }),
  );

  it.effect("refuses more than 5 MiB with 413 MediaTooLarge", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const response = yield* app.upload(
        form(pngOfSize(MediaLimits.maxBytes + 1)),
      );
      assert.strictEqual(response.status, 413);
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        _tag: "MediaTooLarge",
      });
      assert.strictEqual(yield* app.mediaCount, 0);
    }),
  );

  // Known bug: the multipart parser counts a part's headers towards
  // `maxFileSize`, which `uploadMedia` sets to exactly `MediaLimits.maxBytes`,
  // so a file of exactly 5 MiB (allowed by the contract and the database) is
  // refused with 413. Turn this into `it.effect` once the contract allows for
  // the part headers.
  it.effect.fails("accepts exactly 5 MiB", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const response = yield* app.upload(form(pngOfSize(MediaLimits.maxBytes)));
      assert.strictEqual(response.status, 201);
      assert.strictEqual(yield* app.mediaCount, 1);
    }),
  );

  it.effect("answers 400 InvalidUpload without a file part `file`", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const field = new FormData();
      field.append("file", "not a file");
      for (const body of [form(png, { key: "image" }), field]) {
        const response = yield* app.upload(body);
        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
          _tag: "InvalidUpload",
        });
      }
      assert.strictEqual(yield* app.mediaCount, 0);
    }),
  );

  it.effect("answers 400 InvalidUpload for two file parts", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const two = form(png);
      two.append("file", new Blob([png]), "second.png");
      const response = yield* app.upload(two);
      const body = yield* Effect.promise(() => response.text());
      assert.strictEqual(response.status, 400, body);
      assert.deepStrictEqual(JSON.parse(body), { _tag: "InvalidUpload" });
      assert.strictEqual(yield* app.mediaCount, 0);
    }),
  );

  it.effect("refuses a body that is not multipart", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const response = yield* app.call(
        app.editor.cookie,
        "POST",
        "/blogs/alpha/manage/media",
        { body: { file: "x" } },
      );
      const body = yield* Effect.promise(() => response.text());
      assert.strictEqual(response.status, 415, body);
      assert.strictEqual(yield* app.mediaCount, 0);
    }),
  );

  it.effect(
    "answers 404 MediaNotFound for an unknown id, 400 for an invalid one",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        assert.deepStrictEqual(
          yield* app.expect(404, undefined, "GET", `/media/${unknownId}`),
          { _tag: "MediaNotFound" },
        );
        yield* app.expect(400, undefined, "GET", "/media/not-a-uuid");
      }),
  );
});
