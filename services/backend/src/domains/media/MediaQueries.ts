import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import { type MediaId, MediaNotFound, type StoredMedia } from "./Media.ts";
import { MediaRepository } from "./MediaRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* MediaRepository;
  return MediaQueries.of({
    get: Effect.fn("MediaQueries.get")(function* (id: MediaId) {
      const media = yield* repository.findById(id);
      if (Option.isNone(media)) return yield* new MediaNotFound();
      return media.value;
    }, Query.boundary),
  });
});

/**
 * The reads of the media domain. Images are public by their (unguessable)
 * id, also those of drafts: whoever has a post's text may see its images.
 */
export class MediaQueries extends Context.Service<
  MediaQueries,
  {
    readonly get: (id: MediaId) => Effect.Effect<StoredMedia, MediaNotFound>;
  }
>()("@unhalteproblem.de/backend/domains/media/MediaQueries") {
  /** Needs `MediaRepository`. */
  static readonly layer = Layer.effect(MediaQueries, make);
}
