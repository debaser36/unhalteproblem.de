import {
  Context,
  type DateTime,
  Effect,
  Layer,
  type Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";
import type { Price } from "./Pricing.ts";

/**
 * Storage of the food data (`food_items`, `food_prices`). Used only inside
 * the food domain. Numbers are read as `float8` and dates as text, so they
 * arrive as numbers and `YYYY-MM-DD` instead of strings and local-time
 * `Date`s.
 */

const Country = Schema.Literals(["DE", "NZ"]);
const Unit = Schema.Literals(["g", "ml", "piece"]);
const ItemSource = Schema.Literals([
  "openFoodFacts",
  "openPricesCategory",
  "statsNz",
]);
const PriceSourceSchema = Schema.Literals([
  "openPrices",
  "statsNz",
  "estimate",
]);

/** A row of `food_items`. */
export const ItemRow = Schema.Struct({
  id: Schema.String,
  country: Country,
  source: ItemSource,
  sourceRef: Schema.String,
  name: Schema.String,
  brand: Schema.NullOr(Schema.String),
  quantityAmount: Schema.NullOr(Schema.Number),
  quantityUnit: Schema.NullOr(Unit),
  vegetarian: Schema.NullOr(Schema.Boolean),
  vegan: Schema.NullOr(Schema.Boolean),
  categories: Schema.Array(Schema.String),
  ingredients: Schema.Array(Schema.String),
  allergens: Schema.Array(Schema.String),
  updatedAt: Schema.DateTimeUtcFromDate,
});
export type ItemRow = typeof ItemRow.Type;

/** A row of `food_prices`, with the item it belongs to. */
const PriceRow = Schema.Struct({
  foodItemId: Schema.String,
  amount: Schema.Number,
  currency: Schema.Literals(["EUR", "NZD"]),
  source: PriceSourceSchema,
  observedOn: Schema.String,
  accuracy: Schema.Number,
  where: Schema.String,
  discounted: Schema.Boolean,
});
type PriceRow = typeof PriceRow.Type;

/** What an import writes about a food; the key is (country, source, ref). */
export const ItemInput = Schema.Struct({
  country: Country,
  source: ItemSource,
  sourceRef: Schema.String,
  name: Schema.String,
  brand: Schema.NullOr(Schema.String),
  quantity: Schema.NullOr(Schema.Struct({ amount: Schema.Number, unit: Unit })),
  vegetarian: Schema.NullOr(Schema.Boolean),
  vegan: Schema.NullOr(Schema.Boolean),
  categories: Schema.Array(Schema.String),
  ingredients: Schema.Array(Schema.String),
  allergens: Schema.Array(Schema.String),
});
export type ItemInput = typeof ItemInput.Type;

/** What an import writes about a price; the key is (item, source, ref). */
export const PriceInput = Schema.Struct({
  foodItemId: Schema.String,
  sourceRef: Schema.String,
  amount: Schema.Number,
  currency: Schema.Literals(["EUR", "NZD"]),
  source: PriceSourceSchema,
  observedOn: Schema.String,
  accuracy: Schema.Number,
  where: Schema.String,
  discounted: Schema.Boolean,
});
export type PriceInput = typeof PriceInput.Type;

/**
 * The filters of a search. `priced`: `true` only items with a price,
 * `false` only items without one, `null` both.
 */
export const ItemSearch = Schema.Struct({
  country: Country,
  words: Schema.Array(Schema.String),
  diet: Schema.Literals(["omnivore", "vegetarian", "vegan"]),
  priced: Schema.NullOr(Schema.Boolean),
  limit: Schema.Int,
  offset: Schema.Int,
});
export type ItemSearch = typeof ItemSearch.Type;

const columns = `id, country, source, source_ref, name, brand,
  quantity_amount::float8 AS quantity_amount, quantity_unit, vegetarian, vegan,
  categories, ingredients, allergens, updated_at`;

const priceColumns = `food_item_id, amount::float8 AS amount, currency, source,
  observed_on::text AS observed_on, accuracy, where_text AS "where", discounted`;

// Prices older than this are not worth showing or planning with.
const priceWindow = "2 years";

const toPrice = (row: PriceRow): Price => ({
  amount: row.amount,
  currency: row.currency,
  source: row.source,
  observedOn: row.observedOn,
  accuracy: row.accuracy,
  where: row.where,
  discounted: row.discounted,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const select = sql.unsafe(columns);
  const selectPrices = sql.unsafe(priceColumns);

  const upsertItem = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      now: Schema.DateTimeUtcFromDate,
      item: ItemInput,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, now, item }) => sql`
      INSERT INTO food_items (
        id, country, source, source_ref, name, brand, quantity_amount,
        quantity_unit, vegetarian, vegan, categories, ingredients, allergens,
        created_at, updated_at
      ) VALUES (
        ${id}, ${item.country}, ${item.source}, ${item.sourceRef}, ${item.name},
        ${item.brand}, ${item.quantity?.amount ?? null}, ${item.quantity?.unit ?? null},
        ${item.vegetarian}, ${item.vegan}, ${[...item.categories]},
        ${[...item.ingredients]}, ${[...item.allergens]}, ${now}, ${now}
      )
      ON CONFLICT (country, source, source_ref) DO UPDATE SET
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        quantity_amount = EXCLUDED.quantity_amount,
        quantity_unit = EXCLUDED.quantity_unit,
        vegetarian = EXCLUDED.vegetarian,
        vegan = EXCLUDED.vegan,
        categories = EXCLUDED.categories,
        ingredients = EXCLUDED.ingredients,
        allergens = EXCLUDED.allergens,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    `,
  });

  const upsertPrice = SqlSchema.void({
    Request: Schema.Struct({
      now: Schema.DateTimeUtcFromDate,
      price: PriceInput,
    }),
    execute: ({ now, price }) => sql`
      INSERT INTO food_prices (
        food_item_id, source, source_ref, amount, currency, observed_on,
        accuracy, discounted, where_text, created_at
      ) VALUES (
        ${price.foodItemId}, ${price.source}, ${price.sourceRef}, ${price.amount},
        ${price.currency}, ${price.observedOn}::date, ${price.accuracy},
        ${price.discounted}, ${price.where}, ${now}
      )
      ON CONFLICT (food_item_id, source, source_ref) DO UPDATE SET
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        observed_on = EXCLUDED.observed_on,
        accuracy = EXCLUDED.accuracy,
        discounted = EXCLUDED.discounted,
        where_text = EXCLUDED.where_text
    `,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ItemRow,
    execute: (id) => sql`SELECT ${select} FROM food_items WHERE id = ${id}`,
  });

  const findByRefs = SqlSchema.findAll({
    Request: Schema.Struct({
      country: Country,
      source: ItemSource,
      refs: Schema.Array(Schema.String),
    }),
    Result: Schema.Struct({
      id: Schema.String,
      sourceRef: Schema.String,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ country, source, refs }) => sql`
      SELECT id, source_ref, updated_at FROM food_items
      WHERE country = ${country} AND source = ${source}
        AND source_ref = ANY(${[...refs]}::text[])
    `,
  });

  const pricesOf = SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: PriceRow,
    execute: (ids) => sql`
      SELECT ${selectPrices} FROM food_prices
      WHERE food_item_id = ANY(${[...ids]}::uuid[])
        AND observed_on >= current_date - ${priceWindow}::interval
      ORDER BY food_item_id, observed_on DESC, id DESC
    `,
  });

  const dietFilter = (diet: ItemSearch["diet"]) =>
    diet === "vegan"
      ? sql`AND i.vegan IS TRUE`
      : diet === "vegetarian"
        ? sql`AND i.vegetarian IS TRUE`
        : sql``;

  const priced = sql`EXISTS (
    SELECT 1 FROM food_prices p
    WHERE p.food_item_id = i.id
      AND p.observed_on >= current_date - ${priceWindow}::interval
  )`;

  const search = SqlSchema.findAll({
    Request: ItemSearch,
    Result: ItemRow,
    execute: (search) => sql`
      SELECT ${sql.unsafe(columns.replace(/(^|,\s*)(\w+)/gu, "$1i.$2"))}
      FROM food_items i
      WHERE i.country = ${search.country}
        ${
          search.words.length === 0
            ? sql``
            : sql`AND ${sql.and(
                search.words.map(
                  (word) =>
                    sql`(i.name || ' ' || coalesce(i.brand, '')) ILIKE ${`%${word.replace(/[\\%_]/gu, "\\$&")}%`}`,
                ),
              )}`
        }
        ${dietFilter(search.diet)}
        ${
          search.priced === true
            ? sql`AND ${priced}`
            : search.priced === false
              ? sql`AND NOT ${priced}`
              : sql``
        }
      ORDER BY lower(i.name), i.id
      LIMIT ${search.limit} OFFSET ${search.offset}
    `,
  });

  const candidates = SqlSchema.findAll({
    Request: Schema.Struct({
      country: Country,
      diet: Schema.Literals(["omnivore", "vegetarian", "vegan"]),
    }),
    Result: ItemRow,
    execute: ({ country, diet }) => sql`
      SELECT ${sql.unsafe(columns.replace(/(^|,\s*)(\w+)/gu, "$1i.$2"))}
      FROM food_items i
      WHERE i.country = ${country}
        AND i.quantity_amount IS NOT NULL
        ${dietFilter(diet)}
        AND ${priced}
      ORDER BY i.id
      LIMIT 20000
    `,
  });

  const unpriced = SqlSchema.findAll({
    Request: Schema.Struct({ country: Country, limit: Schema.Int }),
    Result: ItemRow,
    execute: ({ country, limit }) => sql`
      SELECT ${sql.unsafe(columns.replace(/(^|,\s*)(\w+)/gu, "$1i.$2"))}
      FROM food_items i
      WHERE i.country = ${country}
        AND i.quantity_amount IS NOT NULL
        AND NOT ${priced}
      ORDER BY i.updated_at DESC, i.id
      LIMIT ${limit}
    `,
  });

  return FoodRepository.of({
    upsertItem: (id, now, item) =>
      upsertItem({ id, now, item }).pipe(
        dieOnSchemaError,
        Effect.flatMap((row) =>
          row._tag === "Some"
            ? Effect.succeed(row.value.id)
            : Effect.die(new Error("Upsert returned no row")),
        ),
        Effect.withSpan("FoodRepository.upsertItem"),
      ),
    upsertPrice: (now, price) =>
      upsertPrice({ now, price }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodRepository.upsertPrice"),
      ),
    find: (id) =>
      find(id).pipe(dieOnSchemaError, Effect.withSpan("FoodRepository.find")),
    knownRefs: (country, source, refs) =>
      refs.length === 0
        ? Effect.succeed(new Map())
        : findByRefs({ country, source, refs }).pipe(
            Effect.map(
              (rows) =>
                new Map(
                  rows.map((row) => [
                    row.sourceRef,
                    { id: row.id, updatedAt: row.updatedAt },
                  ]),
                ),
            ),
            dieOnSchemaError,
            Effect.withSpan("FoodRepository.knownRefs"),
          ),
    pricesOf: (ids) =>
      ids.length === 0
        ? Effect.succeed(new Map())
        : pricesOf(ids).pipe(
            Effect.map((rows) => {
              const byItem = new Map<string, Array<Price>>();
              for (const row of rows) {
                const list = byItem.get(row.foodItemId);
                if (list === undefined)
                  byItem.set(row.foodItemId, [toPrice(row)]);
                else list.push(toPrice(row));
              }
              return byItem;
            }),
            dieOnSchemaError,
            Effect.withSpan("FoodRepository.pricesOf"),
          ),
    search: (filters) =>
      search(filters).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodRepository.search"),
      ),
    candidates: (country, diet) =>
      candidates({ country, diet }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodRepository.candidates"),
      ),
    unpriced: (country, limit) =>
      unpriced({ country, limit }).pipe(
        dieOnSchemaError,
        Effect.withSpan("FoodRepository.unpriced"),
      ),
  });
});

export class FoodRepository extends Context.Service<
  FoodRepository,
  {
    /** Creates the item, or updates the one with the same key; its id. */
    readonly upsertItem: (
      id: string,
      now: DateTime.Utc,
      item: ItemInput,
    ) => Effect.Effect<string, SqlError.SqlError>;
    /** Creates the price, or updates the one with the same key. */
    readonly upsertPrice: (
      now: DateTime.Utc,
      price: PriceInput,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<ItemRow>, SqlError.SqlError>;
    /** Of these source refs, the ones stored: their ids and when they were last updated. */
    readonly knownRefs: (
      country: "DE" | "NZ",
      source: ItemInput["source"],
      refs: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyMap<
        string,
        { readonly id: string; readonly updatedAt: DateTime.Utc }
      >,
      SqlError.SqlError
    >;
    /** The prices of the last two years of these items, newest first per item. */
    readonly pricesOf: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyMap<string, ReadonlyArray<Price>>,
      SqlError.SqlError
    >;
    /** Items whose name or brand contains all the words, by name. */
    readonly search: (
      search: ItemSearch,
    ) => Effect.Effect<ReadonlyArray<ItemRow>, SqlError.SqlError>;
    /** The items a plan may use: priced, with a known package, of the diet. */
    readonly candidates: (
      country: "DE" | "NZ",
      diet: ItemSearch["diet"],
    ) => Effect.Effect<ReadonlyArray<ItemRow>, SqlError.SqlError>;
    /** Items with a known package but no price yet, newest first. */
    readonly unpriced: (
      country: "DE" | "NZ",
      limit: number,
    ) => Effect.Effect<ReadonlyArray<ItemRow>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/food/FoodRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(FoodRepository, make);
}
