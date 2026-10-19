import { Api } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { MediaQueries } from "#domains/media/MediaQueries";

/**
 * Serves uploaded images. An image never changes under its id, so it may
 * be cached for good. Its type was detected from its content at upload;
 * `nosniff` and a sandboxing CSP make sure the browser treats it as
 * nothing but that image, even when opened directly.
 */
export const MediaHandlers = HttpApiBuilder.group(
  Api,
  "media",
  Effect.fn(function* (handlers) {
    const queries = yield* MediaQueries;
    return handlers.handle("getMedia", ({ params }) =>
      queries.get(params.mediaId).pipe(
        Effect.map((media) =>
          HttpServerResponse.uint8Array(media.data, {
            contentType: media.contentType,
            headers: {
              "cache-control": "public, max-age=31536000, immutable",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox",
              "content-disposition": "inline",
              "cross-origin-resource-policy": "same-origin",
            },
          }),
        ),
      ),
    );
  }),
);
