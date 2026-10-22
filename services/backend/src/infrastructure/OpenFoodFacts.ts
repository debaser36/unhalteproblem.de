import {
  Context,
  Duration,
  Effect,
  Layer,
  Predicate,
  Schema,
  Semaphore,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

/**
 * How this backend introduces itself to the open data services it reads
 * from. Open Food Facts asks every API client for a User-Agent that names
 * the app and a way to reach its operator.
 */
export const userAgent =
  "unhalteproblem.de-food-planner/0.1 (+https://unhalteproblem.de)";

/**
 * Open Food Facts did not answer as expected. `reason` is a short code
 * (`search:503`, `transport`, `timeout`, `body`); never a response body.
 */
export class OpenFoodFactsFailed extends Schema.TaggedError<
  OpenFoodFactsFailed,
  { readonly brand: unique symbol }
>()("OpenFoodFactsFailed", { reason: Schema.String }) {
  override get message() {
    return `Open Food Facts request failed (${this.reason})`;
  }
}

/** The countries we look products up in, as Open Food Facts tags them. */
export type OffCountry = "DE" | "NZ";
const countryTags: Record<OffCountry, string> = {
  DE: "en:germany",
  NZ: "en:new-zealand",
};

/** What we keep of an Open Food Facts product. */
export interface OffProduct {
  /** The barcode. */
  readonly code: string;
  readonly name: string;
  readonly brand: string | null;
  /** The package, in g, ml or pieces; null if unknown. */
  readonly quantity: {
    readonly amount: number;
    readonly unit: "g" | "ml" | "piece";
  } | null;
  /** Taxonomy tags, from general to specific, e.g. `en:pastas`. */
  readonly categories: ReadonlyArray<string>;
  /** Label tags, e.g. `en:vegan`. */
  readonly labels: ReadonlyArray<string>;
  /** Open Food Facts' own reading of the ingredients, e.g. `en:non-vegetarian`. */
  readonly ingredientsAnalysis: ReadonlyArray<string>;
  /** Ingredient tags, e.g. `en:wheat-flour`. */
  readonly ingredients: ReadonlyArray<string>;
  /** Allergen tags, e.g. `en:gluten`. */
  readonly allergens: ReadonlyArray<string>;
}

const fields = [
  "code",
  "product_name",
  "brands",
  "product_quantity",
  "product_quantity_unit",
  "quantity",
  "categories_tags",
  "labels_tags",
  "ingredients_analysis_tags",
  "ingredients_tags",
  "allergens_tags",
].join(",");

/** The search service's answer; the hits are read leniently below. */
const SearchResponse = Schema.Struct({
  hits: Schema.Array(Schema.Unknown),
});

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/gu, " ").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
};

// At most 100 tags of at most 100 characters each: enough for any real
// product, and a bound on what a broken record can make us store.
const tags = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value
        .filter(
          (tag): tag is string =>
            typeof tag === "string" && tag.length > 0 && tag.length <= 100,
        )
        .slice(0, 100)
    : [];

const units: Record<string, "g" | "ml"> = {
  g: "g",
  gr: "g",
  kg: "g",
  ml: "ml",
  l: "ml",
  cl: "ml",
};
const factors: Record<string, number> = { kg: 1000, l: 1000, cl: 10 };

const quantityOf = (amount: unknown, unit: unknown): OffProduct["quantity"] => {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const key = typeof unit === "string" ? unit.trim().toLowerCase() : "g";
  const base = units[key];
  if (base === undefined) return null;
  const scaled = value * (factors[key] ?? 1);
  // A product of more than 50 kg is a data error, not a grocery.
  return scaled > 50_000 ? null : { amount: scaled, unit: base };
};

// `500 g`, `1,5 l`, `6 x 125 g`, `10 Stück`: an amount (times a count), a unit.
const quantityText =
  /^\s*(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|l|stück|stk|pcs|pieces?)\b/iu;

/**
 * The package from the free-text `quantity` (`500g`, `6 x 125 g`), which
 * the search service has instead of `product_quantity`.
 */
export const quantityOfText = (value: unknown): OffProduct["quantity"] => {
  if (typeof value !== "string") return null;
  const match = quantityText.exec(value);
  if (match === null) return null;
  const count = match[1] === undefined ? 1 : Number(match[1]);
  const amount = Number(match[2]!.replace(",", ".")) * count;
  const unit = match[3]!.toLowerCase();
  if (/^(?:stück|stk|pcs|pieces?)$/u.test(unit)) {
    return amount > 0 && amount <= 1000 ? { amount, unit: "piece" } : null;
  }
  return quantityOf(amount, unit);
};

/** An Open Food Facts record as `OffProduct`; `undefined` if unusable. */
export const productOf = (record: unknown): OffProduct | undefined => {
  if (!Predicate.isObject(record)) return undefined;
  const r = record as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code : undefined;
  const name = text(r.product_name, 300);
  if (code === undefined || !/^\d{6,14}$/u.test(code) || name === null) {
    return undefined;
  }
  return {
    code,
    name,
    brand: text(
      typeof r.brands === "string" ? r.brands.split(",")[0] : null,
      200,
    ),
    quantity:
      quantityOf(r.product_quantity, r.product_quantity_unit) ??
      quantityOfText(r.quantity),
    categories: tags(r.categories_tags),
    labels: tags(r.labels_tags),
    ingredientsAnalysis: tags(r.ingredients_analysis_tags),
    ingredients: tags(r.ingredients_tags),
    allergens: tags(r.allergens_tags),
  };
};

/**
 * A user's search term as plain words for the search service's query
 * language (Lucene-like): everything but letters, digits and spaces
 * becomes a space, so a term can't add field filters or operators.
 */
export const searchWords = (term: string): string =>
  term
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\b(?:AND|OR|NOT)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const searchUrl = "https://search.openfoodfacts.org/search";
/** Barcodes per lookup request; the service pages at 100. */
export const lookupBatchSize = 100;
// Open Food Facts asks clients to keep their request rate low; one request
// at a time with a pause in between stays far below its limits.
const pause = Duration.seconds(2);
const timeout = Duration.seconds(30);

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const oneAtATime = yield* Semaphore.make(1);

  const search = (stage: string, query: string, size: number) =>
    Effect.gen(function* () {
      const response = yield* http.execute(
        HttpClientRequest.get(searchUrl).pipe(
          HttpClientRequest.setUrlParams({
            q: query,
            fields,
            page_size: String(size),
          }),
          HttpClientRequest.setHeader("user-agent", userAgent),
          HttpClientRequest.acceptJson,
        ),
      );
      if (response.status !== 200) {
        return yield* new OpenFoodFactsFailed({
          reason: `${stage}:${response.status}`,
        });
      }
      const { hits } = yield* Schema.decodeUnknownEffect(SearchResponse)(
        yield* response.json,
      );
      return hits.flatMap((hit) => {
        const product = productOf(hit);
        return product === undefined ? [] : [product];
      });
    }).pipe(
      Effect.catchTags({
        HttpClientError: () =>
          Effect.fail(new OpenFoodFactsFailed({ reason: "transport" })),
        SchemaError: () =>
          Effect.fail(new OpenFoodFactsFailed({ reason: `${stage}:body` })),
      }),
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(new OpenFoodFactsFailed({ reason: "timeout" })),
      }),
      Effect.tap(() => Effect.sleep(pause)),
      oneAtATime.withPermits(1),
    );

  return OpenFoodFacts.of({
    lookup: Effect.fn("OpenFoodFacts.lookup")(function* (
      codes: ReadonlyArray<string>,
    ) {
      const valid = [...new Set(codes)].filter((code) =>
        /^\d{6,14}$/u.test(code),
      );
      const found: Array<OffProduct> = [];
      for (let i = 0; i < valid.length; i += lookupBatchSize) {
        const batch = valid.slice(i, i + lookupBatchSize);
        found.push(
          ...(yield* search(
            "lookup",
            `code:(${batch.join(" OR ")})`,
            lookupBatchSize,
          )),
        );
      }
      return found;
    }),

    search: Effect.fn("OpenFoodFacts.search")(function* (
      term: string,
      country: OffCountry,
    ) {
      const words = searchWords(term);
      if (words === "") return [];
      return yield* search(
        "search",
        `${words} countries_tags:"${countryTags[country]}"`,
        50,
      );
    }),
  });
});

/**
 * Open Food Facts (ODbL): products by barcode, with names, packages,
 * categories, ingredients, allergens and whether they are vegetarian or
 * vegan. Read through its search service, which answers many barcodes at
 * once; requests go out one at a time.
 */
export class OpenFoodFacts extends Context.Service<
  OpenFoodFacts,
  {
    /**
     * The products with these barcodes, as far as Open Food Facts knows
     * them (unknown barcodes are left out). 100 barcodes per request.
     */
    readonly lookup: (
      codes: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<OffProduct>, OpenFoodFactsFailed>;
    /** Up to 50 products sold in `country` that match the words of `term`. */
    readonly search: (
      term: string,
      country: OffCountry,
    ) => Effect.Effect<ReadonlyArray<OffProduct>, OpenFoodFactsFailed>;
  }
>()("@unhalteproblem.de/backend/OpenFoodFacts") {
  /** Over `fetch`. */
  static readonly layer = Layer.effect(OpenFoodFacts, make).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
