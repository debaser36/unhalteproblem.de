import { Effect } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/http";

/** Sets `cache-control` on the response of the effect's request. */
export const cacheControl =
  (value: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.succeed(
        HttpServerResponse.setHeader(response, "cache-control", value),
      ),
    ).pipe(Effect.andThen(self));

/** Personal data or unpublished content: no cache may keep the response. */
export const noStore = cacheControl("no-store");

/**
 * Public, but changes whenever an editor saves: caches must revalidate,
 * and never share a response across users (`private`), since the request
 * might carry a session.
 */
export const revalidate = cacheControl("private, no-cache");
