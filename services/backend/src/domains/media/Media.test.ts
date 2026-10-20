import { assert, describe, it } from "@effect/vitest";
import { MediaLimits } from "@unhalteproblem.de/api";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { createHash } from "node:crypto";
import { member, UsersTest } from "#testing/Users";
import {
  blogScope,
  detectContentType,
  isTooLarge,
  MediaId,
  MediaNotFound,
} from "./Media.ts";
import { MediaCommands } from "./MediaCommands.ts";
import { MediaQueries } from "./MediaQueries.ts";
import { MediaLive } from "./Medias.ts";

const bytes = (...values: ReadonlyArray<number | string>) =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string"
        ? [...value].map((char) => char.charCodeAt(0))
        : [value],
    ),
  );

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = bytes(...pngSignature, 0, 0, 0, 13);

describe("detectContentType", () => {
  it.for([
    ["PNG", png, "image/png"],
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16), "image/jpeg"],
    ["GIF87a", bytes("GIF87a", 1, 0), "image/gif"],
    ["GIF89a", bytes("GIF89a", 1, 0), "image/gif"],
    ["WebP", bytes("RIFF", 36, 0, 0, 0, "WEBPVP8 "), "image/webp"],
    ["AVIF", bytes(0, 0, 0, 28, "ftypavif", 0, 0, 0, 0), "image/avif"],
    ["an AVIF sequence", bytes(0, 0, 0, 28, "ftypavis"), "image/avif"],
  ] as const)("detects %s", ([, content, type]) => {
    assert.deepStrictEqual(detectContentType(content), Option.some(type));
  });

  it.for([
    ["nothing", bytes()],
    ["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["SVG with an XML declaration", bytes('<?xml version="1.0"?><svg/>')],
    ["HTML", bytes("<!doctype html><script>alert(1)</script>")],
    ["a truncated PNG signature", bytes(...pngSignature.slice(0, 7))],
    [
      "a PNG signature with one byte wrong",
      bytes(...pngSignature.slice(0, 7), 0x0b),
    ],
    ["a JPEG start cut off", bytes(0xff, 0xd8)],
    ["GIF with another version", bytes("GIF88a")],
    ["RIFF that is no WebP (WAV)", bytes("RIFF", 36, 0, 0, 0, "WAVEfmt ")],
    ["WEBP without RIFF", bytes("XXXX", 0, 0, 0, 0, "WEBP")],
    ["an MP4 (ISO BMFF, another brand)", bytes(0, 0, 0, 28, "ftypisom")],
    ["PDF", bytes("%PDF-1.7")],
    ["the signature further in", bytes(0, ...pngSignature)],
  ] as const)("refuses %s", ([, content]) => {
    assert.deepStrictEqual(detectContentType(content), Option.none());
  });
});

describe("isTooLarge", () => {
  it("allows 1 byte to 5 MiB", () => {
    assert.isTrue(isTooLarge(new Uint8Array(0)));
    assert.isFalse(isTooLarge(new Uint8Array(1)));
    assert.isFalse(isTooLarge(new Uint8Array(MediaLimits.maxBytes)));
    assert.isTrue(isTooLarge(new Uint8Array(MediaLimits.maxBytes + 1)));
  });
});

/** The media domain on the users domain's fresh database (for uploaders). */
const MediaTest = MediaLive.pipe(Layer.provideMerge(UsersTest));

const mediaCount = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) =>
    sql<{ readonly count: number }>`SELECT count(*)::int AS count FROM media`,
).pipe(
  Effect.map((rows) => rows[0]?.count),
  Effect.orDie,
);

describe("MediaCommands and MediaQueries", () => {
  it.effect(
    "stores an image, which the database checks, and reads it back",
    () =>
      Effect.gen(function* () {
        const commands = yield* MediaCommands;
        const queries = yield* MediaQueries;
        const { user } = yield* member();
        const stored = yield* commands.store({
          scope: blogScope("rust-notes"),
          bytes: png,
          uploadedBy: user.id,
        });
        assert.strictEqual(stored.contentType, "image/png");
        assert.strictEqual(stored.byteSize, png.length);
        assert.deepStrictEqual(
          Buffer.from(stored.sha256),
          createHash("sha256").update(png).digest(),
        );

        const read = yield* queries.get(stored.id);
        assert.deepStrictEqual(Buffer.from(read.data), Buffer.from(png));
        assert.strictEqual(read.scope, "blog:rust-notes");
        assert.deepStrictEqual(read.uploadedBy, Option.some(user.id));
        assert.strictEqual(read.contentType, "image/png");
      }).pipe(Effect.provide(MediaTest)),
  );

  it.effect.each([
    ["an empty file", new Uint8Array(0), "MediaTooLarge"],
    [
      "more than 5 MiB",
      new Uint8Array(MediaLimits.maxBytes + 1).fill(0x89),
      "MediaTooLarge",
    ],
    ["an SVG", bytes("<svg/>"), "UnsupportedMedia"],
    ["random bytes", bytes(1, 2, 3, 4, 5, 6, 7, 8), "UnsupportedMedia"],
  ] as const)("refuses %s and stores nothing", ([, content, tag]) =>
    Effect.gen(function* () {
      const commands = yield* MediaCommands;
      const { user } = yield* member();
      const failure = yield* commands
        .store({
          scope: blogScope("alpha"),
          bytes: content,
          uploadedBy: user.id,
        })
        .pipe(Effect.flip);
      assert.strictEqual(failure._tag, tag);
      assert.strictEqual(yield* mediaCount, 0);
    }).pipe(Effect.provide(MediaTest)),
  );

  it.effect("answers MediaNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const queries = yield* MediaQueries;
      const failure = yield* queries
        .get(MediaId.make("00000000-0000-4000-8000-000000000000"))
        .pipe(Effect.flip);
      assert.instanceOf(failure, MediaNotFound);
    }).pipe(Effect.provide(MediaTest)),
  );
});
