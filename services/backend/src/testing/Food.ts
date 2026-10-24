import { Effect, Layer, Schema } from "effect";
import { Claude, ClaudeFailed, type JsonRequest } from "#infrastructure/Claude";
import { OpenFoodFacts, type OffProduct } from "#infrastructure/OpenFoodFacts";
import { type OpenPrice, OpenPrices } from "#infrastructure/OpenPrices";
import { type AveragePrice, StatsNz } from "#infrastructure/StatsNz";

/**
 * Stand-ins for the food planner's sources, so tests never reach the
 * network: fixed data for the open data services, and a Claude that answers
 * from a script.
 */

/** What the stand-ins hold; every list is empty by default. */
export interface FoodSourceData {
  readonly openPrices?: ReadonlyArray<OpenPrice>;
  readonly products?: ReadonlyArray<OffProduct>;
  readonly statsNz?: ReadonlyArray<AveragePrice>;
}

/** `OpenPrices`, `OpenFoodFacts` and `StatsNz` serving `data`. */
export const fakeFoodSources = (data: FoodSourceData = {}) =>
  Layer.mergeAll(
    Layer.succeed(
      OpenPrices,
      OpenPrices.of({
        prices: (_country, currency, since) =>
          Effect.succeed(
            (data.openPrices ?? []).filter(
              (price) => price.currency === currency && price.date >= since,
            ),
          ),
      }),
    ),
    Layer.succeed(
      OpenFoodFacts,
      OpenFoodFacts.of({
        lookup: (codes) =>
          Effect.succeed(
            (data.products ?? []).filter((product) =>
              codes.includes(product.code),
            ),
          ),
        search: (term) =>
          Effect.succeed(
            (data.products ?? []).filter((product) =>
              product.name.toLowerCase().includes(term.toLowerCase()),
            ),
          ),
      }),
    ),
    Layer.succeed(
      StatsNz,
      StatsNz.of({ latestAveragePrices: Effect.succeed(data.statsNz ?? []) }),
    ),
  );

/**
 * A Claude that answers each request with the next of `answers` (a
 * function gets the request, a `ClaudeFailed` makes the call fail with it), and
 * records the requests. Without answers
 * left it fails with `ClaudeFailed("output")`. `configured: false` makes
 * it act as if no API key were set.
 */
export const makeScriptedClaude = (
  answers: ReadonlyArray<
    unknown | ((request: JsonRequest<unknown>) => unknown)
  > = [],
  options: { readonly configured?: boolean } = {},
) => {
  const requests: Array<JsonRequest<unknown>> = [];
  const queue = [...answers];
  const configured = options.configured ?? true;
  const layer = Layer.succeed(
    Claude,
    Claude.of({
      model: "claude-test",
      configured,
      json: <A>(request: JsonRequest<A>) =>
        Effect.gen(function* () {
          if (!configured)
            return yield* new ClaudeFailed({ reason: "unconfigured" });
          requests.push(request as JsonRequest<unknown>);
          const next = queue.shift();
          if (next instanceof ClaudeFailed) return yield* next;
          if (next === undefined)
            return yield* new ClaudeFailed({ reason: "output" });
          const answer =
            typeof next === "function"
              ? (next as (request: JsonRequest<unknown>) => unknown)(
                  request as JsonRequest<unknown>,
                )
              : next;
          const value = yield* Schema.decodeUnknownEffect(request.schema)(
            answer,
          ).pipe(Effect.mapError(() => new ClaudeFailed({ reason: "output" })));
          return { value, model: "claude-test" };
        }),
    }),
  );
  return { layer, requests };
};
