import { Forbidden, SameOrigin } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { PublicUrlConfig } from "#Config";

/**
 * Fails with `Forbidden` unless the request's `Origin` header is exactly
 * `origin`. Browsers send it on every POST and every non-GET `fetch`, so a
 * missing one is refused too.
 */
export const requireSameOrigin = Effect.fn(function* (origin: string) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.headers["origin"] === origin) return;
  // Whether it was missing or foreign, not the value itself: that is
  // whatever the sender chose.
  yield* Effect.logWarning("Cross-origin request refused").pipe(
    Effect.annotateLogs({
      origin: request.headers["origin"] === undefined ? "missing" : "foreign",
    }),
  );
  return yield* new Forbidden();
});

/**
 * Refuses state-changing requests that don't come from the website itself
 * (`requireSameOrigin` with `PUBLIC_ORIGIN`). The session cookie is
 * SameSite=Lax, which still lets same-site pages (any `*.unhalteproblem.de`)
 * send it; this closes that gap.
 */
export const SameOriginLive = Layer.effect(
  SameOrigin,
  Effect.gen(function* () {
    const { origin } = yield* PublicUrlConfig;
    return SameOrigin.of((httpEffect) =>
      requireSameOrigin(origin).pipe(Effect.andThen(httpEffect)),
    );
  }),
);
