import { Context, DateTime, Effect, Layer, Option } from "effect";
import { createHash } from "node:crypto";
import * as Command from "#cqrs/Command";
import { Transaction } from "#cqrs/Transaction";
import type { UserId } from "#domains/users/User";
import {
  detectContentType,
  InvalidUpload,
  isTooLarge,
  MediaId,
  type MediaScope,
  MediaTooLarge,
  StoredMedia,
  UnsupportedMedia,
} from "./Media.ts";
import { MediaRepository } from "./MediaRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* MediaRepository;
  const transaction = yield* Transaction;

  return MediaCommands.of({
    store: Effect.fn("MediaCommands.store")(function* (upload: {
      readonly scope: MediaScope;
      readonly bytes: Uint8Array;
      readonly uploadedBy: UserId;
    }) {
      // An empty file is a broken upload, not a big one.
      if (upload.bytes.length === 0) return yield* new InvalidUpload();
      if (isTooLarge(upload.bytes)) return yield* new MediaTooLarge();
      const contentType = detectContentType(upload.bytes);
      if (Option.isNone(contentType)) return yield* new UnsupportedMedia();
      const media = new StoredMedia({
        id: MediaId.make(crypto.randomUUID()),
        contentType: contentType.value,
        data: upload.bytes,
        byteSize: upload.bytes.length,
        sha256: createHash("sha256").update(upload.bytes).digest(),
        scope: upload.scope,
        uploadedBy: Option.some(upload.uploadedBy),
        uploadedAt: yield* DateTime.now,
      });
      yield* repository.insert(media);
      return media;
    }, Command.boundary(transaction)),
  });
});

/**
 * The commands of the media domain. They check the file (size, and a type
 * detected from its content), not the uploader: only call them from a
 * command that has checked the uploader's right to the scope (e.g.
 * `BlogCommands.uploadImage`, which requires the blog's editor role).
 */
export class MediaCommands extends Context.Service<
  MediaCommands,
  {
    /** Stores an uploaded image; fails if it is empty (400), too large (413) or not an image we serve (415). */
    readonly store: (upload: {
      readonly scope: MediaScope;
      readonly bytes: Uint8Array;
      readonly uploadedBy: UserId;
    }) => Effect.Effect<
      StoredMedia,
      InvalidUpload | MediaTooLarge | UnsupportedMedia
    >;
  }
>()("@unhalteproblem.de/backend/domains/media/MediaCommands") {
  /** Needs `MediaRepository` and `Transaction`. */
  static readonly layer = Layer.effect(MediaCommands, make);
}
