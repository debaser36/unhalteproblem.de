import { Forbidden, SameOrigin } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { PublicUrlConfig } from "#Config";

/**
 * Refuses state-changing requests that don't come from the website itself:
 * the `Origin` header must be exactly `PUBLIC_ORIGIN`. Browsers send it on
 * every non-GET `fetch`, so a missing one is refused too. The session
 * cookie is SameSite=Lax, which still lets same-site pages (any
 * `*.unhalteproblem.de`) send it; this closes that gap.
 */
export const SameOriginLive = Layer.effect(
  SameOrigin,
  Effect.gen(function* () {
    const { origin } = yield* PublicUrlConfig;
    return SameOrigin.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.headers["origin"] !== origin) {
          // Whether it was missing or foreign, not the value itself: that
          // is whatever the sender chose.
          yield* Effect.logWarning("Cross-origin request refused").pipe(
            Effect.annotateLogs({
              origin:
                request.headers["origin"] === undefined ? "missing" : "foreign",
            }),
          );
          return yield* new Forbidden();
        }
        return yield* httpEffect;
      }),
    );
  }),
);
