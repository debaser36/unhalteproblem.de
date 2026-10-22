import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { userAgent } from "./OpenFoodFacts.ts";

/**
 * The Open Prices dumps could not be read. `reason` is a short code
 * (`prices:503`, `transport`, `gzip`, `timeout`); never a response body.
 */
export class OpenPricesFailed extends Schema.TaggedError<
  OpenPricesFailed,
  { readonly brand: unique symbol }
>()("OpenPricesFailed", { reason: Schema.String }) {
  override get message() {
    return `Open Prices download failed (${this.reason})`;
  }
}

/** A shop prices were recorded in. */
export interface OpenPricesLocation {
  readonly id: number;
  /** The brand or the shop's name, e.g. `Lidl`. */
  readonly name: string | null;
  readonly city: string | null;
}

/** One recorded price, as far as we use it. */
export interface OpenPrice {
  readonly id: number;
  /** The barcode of a product, or `null` for a category price. */
  readonly code: string | null;
  /** The category of a category price (loose produce), e.g. `en:apples`. */
  readonly category: string | null;
  readonly price: number;
  readonly discounted: boolean;
  /** What a category price is for; product prices are for one package. */
  readonly per: "kilogram" | "unit" | null;
  readonly currency: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly location: OpenPricesLocation;
}

const dumps = "https://prices.openfoodfacts.org/data";

const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, max)
    : null;

/** A line of `locations.jsonl` as a location in `country`, if it is one. */
export const locationOf = (
  record: unknown,
  country: string,
): OpenPricesLocation | undefined => {
  if (!Predicate.isObject(record)) return undefined;
  const r = record as Record<string, unknown>;
  if (r.osm_address_country_code !== country || typeof r.id !== "number") {
    return undefined;
  }
  return {
    id: r.id,
    name: str(r.osm_brand, 100) ?? str(r.osm_name, 100),
    city: str(r.osm_address_city, 100),
  };
};

/**
 * A line of `prices.jsonl` as a price we can use: in `currency`, recorded
 * at one of `locations` on or after `since`, not marked as a duplicate, and
 * either for a barcode or for a category.
 */
export const priceOf = (
  record: unknown,
  filter: {
    readonly currency: string;
    readonly since: string;
    readonly locations: ReadonlyMap<number, OpenPricesLocation>;
  },
): OpenPrice | undefined => {
  if (!Predicate.isObject(record)) return undefined;
  const r = record as Record<string, unknown>;
  if (r.currency !== filter.currency || r.duplicate_of != null) {
    return undefined;
  }
  const location =
    typeof r.location_id === "number"
      ? filter.locations.get(r.location_id)
      : undefined;
  const date = typeof r.date === "string" ? r.date : "";
  if (
    location === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    date < filter.since ||
    typeof r.id !== "number"
  ) {
    return undefined;
  }
  const price = Number(r.price);
  // Prices of more than 1000 per package or kilogram are typos or not food.
  if (!Number.isFinite(price) || price <= 0 || price > 1000) return undefined;
  const code =
    r.type === "PRODUCT" &&
    typeof r.product_code === "string" &&
    /^\d{6,14}$/u.test(r.product_code)
      ? r.product_code
      : null;
  const category =
    r.type === "CATEGORY" &&
    typeof r.category_tag === "string" &&
    /^[a-z]{2}:[\p{L}\p{N}-]{1,80}$/u.test(r.category_tag)
      ? r.category_tag
      : null;
  if (code === null && category === null) return undefined;
  return {
    id: r.id,
    code,
    category,
    price,
    discounted: r.price_is_discounted === true,
    per:
      r.price_per === "KILOGRAM"
        ? "kilogram"
        : r.price_per === "UNIT"
          ? "unit"
          : null,
    currency: filter.currency,
    date,
    location,
  };
};

const parseLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
);

const timeout = Duration.minutes(10);

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  /** The lines of a gzipped JSONL dump, parsed; broken lines are `undefined`. */
  const records = (name: string) =>
    Stream.unwrap(
      http
        .execute(
          HttpClientRequest.get(`${dumps}/${name}.jsonl.gz`).pipe(
            HttpClientRequest.setHeader("user-agent", userAgent),
          ),
        )
        .pipe(
          Effect.flatMap((response: HttpClientResponse.HttpClientResponse) =>
            response.status === 200
              ? Effect.succeed(response.stream)
              : Effect.fail(
                  new OpenPricesFailed({
                    reason: `${name}:${response.status}`,
                  }),
                ),
          ),
          Effect.catchTag("HttpClientError", () =>
            Effect.fail(new OpenPricesFailed({ reason: "transport" })),
          ),
        ),
    ).pipe(
      Stream.catchTag("HttpClientError", () =>
        Stream.fail(new OpenPricesFailed({ reason: "transport" })),
      ),
      (compressed) =>
        Stream.fromReadableStream({
          evaluate: () =>
            Stream.toReadableStream(compressed).pipeThrough(
              // The DOM typings want chunks over a plain `ArrayBuffer`; the
              // response's chunks are typed over `ArrayBufferLike`. Node's
              // stream takes either.
              new DecompressionStream(
                "gzip",
              ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
            ),
          onError: () => new OpenPricesFailed({ reason: "gzip" }),
        }),
      Stream.decodeText,
      Stream.splitLines,
      Stream.map((line) => Option.getOrUndefined(parseLine(line))),
    );

  return OpenPrices.of({
    prices: Effect.fn("OpenPrices.prices")(
      function* (country: string, currency: string, since: string) {
        const locations = new Map<number, OpenPricesLocation>();
        yield* records("locations").pipe(
          Stream.runForEach((record) =>
            Effect.sync(() => {
              const location = locationOf(record, country);
              if (location !== undefined) locations.set(location.id, location);
            }),
          ),
        );
        const prices: Array<OpenPrice> = [];
        yield* records("prices").pipe(
          Stream.runForEach((record) =>
            Effect.sync(() => {
              const price = priceOf(record, { currency, since, locations });
              if (price !== undefined) prices.push(price);
            }),
          ),
        );
        return prices;
      },
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new OpenPricesFailed({ reason: "timeout" })),
      }),
    ),
  });
});

/**
 * Open Prices (Open Food Facts, ODbL): prices people recorded in shops,
 * from receipts and price tags. Read from the daily dumps (a few dozen MB,
 * streamed), since the API cannot filter by country.
 */
export class OpenPrices extends Context.Service<
  OpenPrices,
  {
    /**
     * The prices recorded in shops in `country` (ISO code, e.g. `DE`) in
     * `currency` on or after `since` (`YYYY-MM-DD`).
     */
    readonly prices: (
      country: string,
      currency: string,
      since: string,
    ) => Effect.Effect<ReadonlyArray<OpenPrice>, OpenPricesFailed>;
  }
>()("@unhalteproblem.de/backend/OpenPrices") {
  /** Over `fetch`. */
  static readonly layer = Layer.effect(OpenPrices, make).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
