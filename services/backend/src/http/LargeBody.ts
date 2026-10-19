import { LargeBody } from "@unhalteproblem.de/api";
import { ByteSize, Effect, Layer } from "effect";
import { HttpIncomingMessage } from "effect/http";

/**
 * The body limit of the endpoints marked `LargeBody` (saving a post): 512
 * KiB instead of the server's 32 KiB. A post's document is JSON and can be
 * long; images are uploaded separately, so this is plenty for text.
 *
 * nginx needs the same limit for these locations (see the NixOS module).
 */
export const LargeBodyLimit = ByteSize.kibibytes(512);

export const LargeBodyLive = Layer.succeed(LargeBody, (httpEffect) =>
  Effect.provideService(
    httpEffect,
    HttpIncomingMessage.MaxBodySize,
    LargeBodyLimit,
  ),
);
