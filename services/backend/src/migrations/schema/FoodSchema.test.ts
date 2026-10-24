import { assert, describe, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { SqlClient, type SqlError, type Statement } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertFoodImport,
  insertFoodItem,
  insertFoodPrice,
  insertMealPlan,
  insertUser,
  readyMealPlan,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

/** Fails unless `effect` fails with a violation of `constraint`. */
const expectViolation = <A, R>(
  effect: Effect.Effect<A, SqlError.SqlError, R>,
  constraint: string,
) =>
  effect.pipe(
    Effect.tap(() => Effect.sync(() => assert.fail(`accepted: ${constraint}`))),
    Effect.flip,
    Effect.map((error) => {
      if (error.reason._tag === "UniqueViolation") {
        assert.strictEqual(error.reason.constraint, constraint);
      } else {
        assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
        assert.propertyVal(error.reason.cause, "constraint", constraint);
      }
    }),
  );

/** EXPLAIN of `query` with sequential and bitmap scans turned off. */
const explain = (sql: SqlClient.SqlClient, query: Statement.Fragment) =>
  sql.withTransaction(
    Effect.gen(function* () {
      // The tables are tiny and have no statistics, so the planner would
      // prefer a sequential scan, or a bitmap scan and a sort.
      yield* sql`SET LOCAL enable_seqscan = off`;
      yield* sql`SET LOCAL enable_bitmapscan = off`;
      const plan = yield* sql<Record<string, string>>`${query}`;
      return plan.flatMap((row) => Object.values(row)).join("\n");
    }),
  );

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the food tables with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "food_items"), [
          "food_items.id uuid not null",
          "food_items.country text not null",
          "food_items.source text not null",
          "food_items.source_ref text not null",
          "food_items.name text not null",
          "food_items.brand text",
          "food_items.quantity_amount numeric",
          "food_items.quantity_unit text",
          "food_items.vegetarian boolean",
          "food_items.vegan boolean",
          "food_items.categories ARRAY not null default '{}'::text[]",
          "food_items.ingredients ARRAY not null default '{}'::text[]",
          "food_items.allergens ARRAY not null default '{}'::text[]",
          "food_items.created_at timestamp with time zone not null",
          "food_items.updated_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "food_prices"), [
          "food_prices.id bigint not null generated always as identity",
          "food_prices.food_item_id uuid not null",
          "food_prices.source text not null",
          "food_prices.source_ref text not null",
          "food_prices.amount numeric not null",
          "food_prices.currency text not null",
          "food_prices.observed_on date not null",
          "food_prices.accuracy smallint not null",
          "food_prices.discounted boolean not null default false",
          "food_prices.where_text text not null",
          "food_prices.created_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "food_imports"), [
          "food_imports.id uuid not null",
          "food_imports.country text not null",
          "food_imports.source text not null",
          "food_imports.status text not null",
          "food_imports.requested_by uuid",
          "food_imports.requested_at timestamp with time zone not null",
          "food_imports.started_at timestamp with time zone",
          "food_imports.finished_at timestamp with time zone",
          "food_imports.items integer not null default 0",
          "food_imports.prices integer not null default 0",
          "food_imports.error text",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "meal_plans"), [
          "meal_plans.id uuid not null",
          "meal_plans.user_id uuid not null",
          "meal_plans.country text not null",
          "meal_plans.currency text not null",
          "meal_plans.status text not null",
          "meal_plans.request jsonb not null",
          "meal_plans.plan jsonb",
          "meal_plans.total_cost numeric",
          "meal_plans.cheapest_total numeric",
          "meal_plans.estimated_share smallint",
          "meal_plans.accuracy smallint",
          "meal_plans.model text",
          "meal_plans.failure_reason text",
          "meal_plans.created_at timestamp with time zone not null",
          "meal_plans.finished_at timestamp with time zone",
          // Added by 0021.
          "meal_plans.started_at timestamp with time zone",
        ]);

        // Money is numeric(12, 2); package sizes are unconstrained numeric.
        const numerics = yield* sql<{
          readonly column: string;
          readonly precision: number | null;
          readonly scale: number | null;
        }>`
          SELECT table_name || '.' || column_name AS column,
            numeric_precision AS precision, numeric_scale AS scale
          FROM information_schema.columns
          WHERE table_schema = 'public' AND data_type = 'numeric'
            AND table_name IN ('food_items', 'food_prices', 'meal_plans')
          ORDER BY table_name, ordinal_position
        `;
        assert.deepStrictEqual(numerics, [
          {
            column: "food_items.quantity_amount",
            precision: null,
            scale: null,
          },
          { column: "food_prices.amount", precision: 12, scale: 2 },
          { column: "meal_plans.total_cost", precision: 12, scale: 2 },
          { column: "meal_plans.cheapest_total", precision: 12, scale: 2 },
        ]);
      }),
    );

    it.effect("constrains and indexes food_items", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "food_items"), [
          "food_items_allergens_check: CHECK ((array_position(allergens, NULL::text) IS NULL))",
          "food_items_brand_check: CHECK ((char_length(brand) <= 200))",
          "food_items_categories_check: CHECK ((array_position(categories, NULL::text) IS NULL))",
          "food_items_country_check: CHECK ((country = ANY (ARRAY['DE'::text, 'NZ'::text])))",
          "food_items_country_source_source_ref_key: UNIQUE (country, source, source_ref)",
          "food_items_id_pkey: PRIMARY KEY (id)",
          "food_items_ingredients_check: CHECK ((array_position(ingredients, NULL::text) IS NULL))",
          "food_items_name_check: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300)))",
          "food_items_quantity_amount_check: CHECK ((quantity_amount > (0)::numeric))",
          "food_items_quantity_check: CHECK (((quantity_amount IS NULL) = (quantity_unit IS NULL)))",
          "food_items_quantity_unit_check: CHECK ((quantity_unit = ANY (ARRAY['g'::text, 'ml'::text, 'piece'::text])))",
          "food_items_source_check: CHECK ((source = ANY (ARRAY['openFoodFacts'::text, 'openPricesCategory'::text, 'statsNz'::text])))",
          "food_items_source_ref_check: CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 200)))",
          "food_items_vegan_check: CHECK ((NOT (vegan AND (vegetarian IS FALSE))))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "food_items"), [
          "CREATE INDEX food_items_country_lower_name_id_idx ON public.food_items USING btree (country, lower(name), id)",
          "CREATE UNIQUE INDEX food_items_country_source_source_ref_key ON public.food_items USING btree (country, source, source_ref)",
          "CREATE UNIQUE INDEX food_items_id_pkey ON public.food_items USING btree (id)",
        ]);
      }),
    );

    it.effect("constrains and indexes food_prices", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "food_prices"), [
          "food_prices_accuracy_check: CHECK (((accuracy >= 0) AND (accuracy <= 100)))",
          "food_prices_amount_check: CHECK ((amount >= (0)::numeric))",
          "food_prices_currency_check: CHECK ((currency = ANY (ARRAY['EUR'::text, 'NZD'::text])))",
          "food_prices_estimate_check: CHECK (((source <> 'estimate'::text) OR (source_ref = 'estimate'::text)))",
          "food_prices_food_item_id_fkey: FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE CASCADE",
          "food_prices_food_item_id_source_source_ref_key: UNIQUE (food_item_id, source, source_ref)",
          "food_prices_id_pkey: PRIMARY KEY (id)",
          "food_prices_source_check: CHECK ((source = ANY (ARRAY['openPrices'::text, 'statsNz'::text, 'estimate'::text])))",
          "food_prices_source_ref_check: CHECK (((char_length(source_ref) >= 1) AND (char_length(source_ref) <= 200)))",
          "food_prices_where_text_check: CHECK (((char_length(where_text) >= 1) AND (char_length(where_text) <= 300)))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "food_prices"), [
          "CREATE INDEX food_prices_food_item_id_observed_on_idx ON public.food_prices USING btree (food_item_id, observed_on DESC)",
          "CREATE UNIQUE INDEX food_prices_food_item_id_source_source_ref_key ON public.food_prices USING btree (food_item_id, source, source_ref)",
          "CREATE UNIQUE INDEX food_prices_id_pkey ON public.food_prices USING btree (id)",
        ]);
      }),
    );

    it.effect("constrains and indexes food_imports", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "food_imports"),
          [
            "food_imports_country_check: CHECK ((country = ANY (ARRAY['DE'::text, 'NZ'::text])))",
            "food_imports_error_check: CHECK ((char_length(error) <= 200))",
            "food_imports_id_pkey: PRIMARY KEY (id)",
            "food_imports_items_check: CHECK ((items >= 0))",
            "food_imports_lifecycle_check: CHECK ((((status = ANY (ARRAY['succeeded'::text, 'failed'::text])) = (finished_at IS NOT NULL)) AND ((status <> 'running'::text) OR (started_at IS NOT NULL)) AND ((started_at IS NULL) OR (started_at >= requested_at)) AND ((finished_at IS NULL) OR (finished_at >= COALESCE(started_at, requested_at)))))",
            "food_imports_prices_check: CHECK ((prices >= 0))",
            "food_imports_requested_by_fkey: FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL",
            "food_imports_source_check: CHECK ((source = ANY (ARRAY['openPrices'::text, 'statsNz'::text, 'priceEstimates'::text])))",
            "food_imports_status_check: CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))",
          ],
        );
        // requested_by is deliberately not indexed.
        assert.deepStrictEqual(yield* describeIndexes(sql, "food_imports"), [
          "CREATE UNIQUE INDEX food_imports_active_key ON public.food_imports USING btree (country, source) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]))",
          "CREATE UNIQUE INDEX food_imports_id_pkey ON public.food_imports USING btree (id)",
          "CREATE INDEX food_imports_requested_at_idx ON public.food_imports USING btree (requested_at DESC)",
        ]);
      }),
    );

    it.effect("constrains and indexes meal_plans", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "meal_plans"), [
          "meal_plans_accuracy_check: CHECK (((accuracy >= 0) AND (accuracy <= 100)))",
          "meal_plans_cheapest_total_check: CHECK ((cheapest_total >= (0)::numeric))",
          "meal_plans_country_check: CHECK ((country = ANY (ARRAY['DE'::text, 'NZ'::text])))",
          "meal_plans_country_currency_check: CHECK ((((country = 'DE'::text) AND (currency = 'EUR'::text)) OR ((country = 'NZ'::text) AND (currency = 'NZD'::text))))",
          "meal_plans_estimated_share_check: CHECK (((estimated_share >= 0) AND (estimated_share <= 100)))",
          "meal_plans_failed_check: CHECK (((status <> 'failed'::text) OR ((failure_reason IS NOT NULL) AND (finished_at IS NOT NULL))))",
          "meal_plans_failure_reason_check: CHECK ((failure_reason = ANY (ARRAY['noCandidates'::text, 'overBudget'::text, 'invalidPlan'::text, 'plannerFailed'::text])))",
          "meal_plans_finished_at_check: CHECK ((finished_at >= created_at))",
          "meal_plans_id_pkey: PRIMARY KEY (id)",
          "meal_plans_model_check: CHECK (((char_length(model) >= 1) AND (char_length(model) <= 100)))",
          "meal_plans_pending_check: CHECK (((status <> 'pending'::text) OR ((plan IS NULL) AND (finished_at IS NULL) AND (failure_reason IS NULL))))",
          "meal_plans_plan_check: CHECK ((jsonb_typeof(plan) = 'object'::text))",
          "meal_plans_ready_check: CHECK (((status = 'ready'::text) = ((plan IS NOT NULL) AND (total_cost IS NOT NULL) AND (estimated_share IS NOT NULL) AND (accuracy IS NOT NULL) AND (model IS NOT NULL) AND (finished_at IS NOT NULL) AND (failure_reason IS NULL))))",
          "meal_plans_request_check: CHECK ((jsonb_typeof(request) = 'object'::text))",
          "meal_plans_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])))",
          "meal_plans_total_cost_check: CHECK ((total_cost >= (0)::numeric))",
          "meal_plans_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "meal_plans"), [
          "CREATE UNIQUE INDEX meal_plans_id_pkey ON public.meal_plans USING btree (id)",
          "CREATE INDEX meal_plans_user_id_created_at_idx ON public.meal_plans USING btree (user_id, created_at DESC)",
        ]);
      }),
    );

    it.effect("accepts valid food items and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertFoodItem(sql, { sourceRef: "4000000000001" });
        // The limits: 200-character source_ref and brand, 300-character name
        // (code points), every country, source and unit, and unknown diets.
        yield* insertFoodItem(sql, {
          country: "NZ",
          source: "statsNz",
          sourceRef: "S".repeat(200),
          name: "😀".repeat(300),
          brand: "😀".repeat(200),
          quantityAmount: "0.001",
          quantityUnit: "g",
          vegetarian: null,
          vegan: null,
          categories: ["en:apples", "en:fruits"],
          ingredients: ["en:apple"],
          allergens: ["en:gluten"],
        });
        yield* insertFoodItem(sql, {
          source: "openPricesCategory",
          sourceRef: "en:apples",
          quantityAmount: 1,
          quantityUnit: "piece",
          vegetarian: true,
          vegan: true,
        });
        yield* insertFoodItem(sql, {
          sourceRef: "4000000000002",
          brand: "",
          quantityAmount: 500,
          quantityUnit: "ml",
          vegetarian: false,
          vegan: false,
        });
        // Vegan with vegetarian unknown, and not vegan but vegetarian.
        yield* insertFoodItem(sql, {
          sourceRef: "4000000000003",
          vegetarian: null,
          vegan: true,
        });
        yield* insertFoodItem(sql, {
          sourceRef: "4000000000004",
          vegetarian: true,
          vegan: false,
        });
        // Not vegetarian, vegan unknown.
        yield* insertFoodItem(sql, {
          sourceRef: "4000000000005",
          vegetarian: false,
          vegan: null,
        });

        const cases = [
          [{ country: "AT" }, "food_items_country_check"],
          [{ country: "de" }, "food_items_country_check"],
          [{ source: "openPrices" }, "food_items_source_check"],
          [{ source: "OpenFoodFacts" }, "food_items_source_check"],
          [{ sourceRef: "" }, "food_items_source_ref_check"],
          [{ sourceRef: "s".repeat(201) }, "food_items_source_ref_check"],
          [{ name: "" }, "food_items_name_check"],
          [{ name: "n".repeat(301) }, "food_items_name_check"],
          [{ brand: "b".repeat(201) }, "food_items_brand_check"],
          [
            { quantityAmount: 0, quantityUnit: "g" },
            "food_items_quantity_amount_check",
          ],
          [
            { quantityAmount: -1, quantityUnit: "g" },
            "food_items_quantity_amount_check",
          ],
          [
            { quantityAmount: 1, quantityUnit: "kg" },
            "food_items_quantity_unit_check",
          ],
          [{ quantityAmount: 1 }, "food_items_quantity_check"],
          [{ quantityUnit: "g" }, "food_items_quantity_check"],
          [{ vegan: true, vegetarian: false }, "food_items_vegan_check"],
          [{ categories: ["en:apples", null] }, "food_items_categories_check"],
          [{ ingredients: [null] }, "food_items_ingredients_check"],
          [{ allergens: [null, "en:milk"] }, "food_items_allergens_check"],
        ] as const;
        for (const [item, constraint] of cases) {
          yield* expectViolation(
            insertFoodItem(sql, { sourceRef: "4000000000099", ...item }),
            constraint,
          );
        }
      }),
    );

    it.effect("identifies a food item by country, source and reference", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const id = yield* insertFoodItem(sql, { sourceRef: "4000000000100" });
        // The same reference in another country or from another source is
        // another item.
        yield* insertFoodItem(sql, {
          country: "NZ",
          sourceRef: "4000000000100",
        });
        yield* insertFoodItem(sql, {
          source: "openPricesCategory",
          sourceRef: "4000000000100",
        });
        yield* expectViolation(
          insertFoodItem(sql, { sourceRef: "4000000000100" }),
          "food_items_country_source_source_ref_key",
        );

        // A re-import updates the row in place.
        const [upserted] = yield* sql<{ readonly id: string }>`
          INSERT INTO food_items (
            id, country, source, source_ref, name, created_at, updated_at
          )
          VALUES (
            gen_random_uuid(), 'DE', 'openFoodFacts', '4000000000100',
            'Renamed', now(), now()
          )
          ON CONFLICT ON CONSTRAINT food_items_country_source_source_ref_key
          DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
          RETURNING id
        `;
        assert.strictEqual(upserted.id, id);
      }),
    );

    it.effect("lists and searches a country's items with the name index", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const [country, sourceRef, name] of [
          ["DE", "search-1", "Bio Äpfel"],
          ["DE", "search-2", "apfelsaft"],
          ["DE", "search-3", "Zwiebeln"],
          ["NZ", "search-4", "Apples"],
        ] as const) {
          yield* insertFoodItem(sql, { country, sourceRef, name });
        }
        const rows = yield* sql<{ readonly name: string }>`
          SELECT name FROM food_items
          WHERE country = 'DE' AND name ILIKE ${"%apfel%"}
            AND source_ref LIKE 'search-%'
          ORDER BY lower(name), id
        `;
        assert.deepStrictEqual(
          rows.map((row) => row.name),
          ["apfelsaft"],
        );

        const text = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM food_items
            WHERE country = 'DE' AND name ILIKE '%apfel%'
            ORDER BY lower(name), id
            LIMIT 50
          `,
        );
        assert.include(text, "food_items_country_lower_name_id_idx");
        // The index delivers the order; no sort step.
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("accepts valid prices and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const item = yield* insertFoodItem(sql, { sourceRef: "price-item" });
        yield* insertFoodPrice(sql, { foodItemId: item, sourceRef: "1001" });
        // The limits: amount 0 and 9999999999.99, accuracy 0 and 100,
        // 200-character source_ref, 300-character where_text.
        yield* insertFoodPrice(sql, {
          foodItemId: item,
          source: "statsNz",
          sourceRef: "😀".repeat(200),
          amount: 0,
          currency: "NZD",
          accuracy: 0,
          discounted: true,
          whereText: "😀".repeat(300),
        });
        yield* insertFoodPrice(sql, {
          foodItemId: item,
          sourceRef: "1002",
          amount: "9999999999.99",
          accuracy: 100,
        });
        yield* insertFoodPrice(sql, {
          foodItemId: item,
          source: "estimate",
          sourceRef: "estimate",
        });

        // Amounts are rounded to cents.
        const [rounded] = yield* sql<{ readonly amount: string }>`
          SELECT amount::text AS amount FROM food_prices
          WHERE id = ${yield* insertFoodPrice(sql, {
            foodItemId: item,
            sourceRef: "1003",
            amount: "1.005",
          })}
        `;
        assert.strictEqual(rounded.amount, "1.01");

        const cases = [
          [{ source: "openFoodFacts" }, "food_prices_source_check"],
          [{ source: "Estimate" }, "food_prices_source_check"],
          [{ sourceRef: "" }, "food_prices_source_ref_check"],
          [{ sourceRef: "s".repeat(201) }, "food_prices_source_ref_check"],
          [{ source: "estimate" }, "food_prices_estimate_check"],
          [{ amount: "-0.01" }, "food_prices_amount_check"],
          [{ currency: "USD" }, "food_prices_currency_check"],
          [{ currency: "eur" }, "food_prices_currency_check"],
          [{ accuracy: -1 }, "food_prices_accuracy_check"],
          [{ accuracy: 101 }, "food_prices_accuracy_check"],
          [{ whereText: "" }, "food_prices_where_text_check"],
          [{ whereText: "w".repeat(301) }, "food_prices_where_text_check"],
          [
            { foodItemId: "00000000-0000-4000-8000-000000000f01" },
            "food_prices_food_item_id_fkey",
          ],
        ] as const;
        for (const [price, constraint] of cases) {
          yield* expectViolation(
            insertFoodPrice(sql, {
              foodItemId: item,
              sourceRef: "1099",
              ...price,
            }),
            constraint,
          );
        }

        // A price per source reference, and one estimate per item.
        yield* expectViolation(
          insertFoodPrice(sql, { foodItemId: item, sourceRef: "1001" }),
          "food_prices_food_item_id_source_source_ref_key",
        );
        yield* expectViolation(
          insertFoodPrice(sql, {
            foodItemId: item,
            source: "estimate",
            sourceRef: "estimate",
          }),
          "food_prices_food_item_id_source_source_ref_key",
        );

        // The database numbers the prices itself.
        const exit = yield* sql`
          INSERT INTO food_prices (
            id, food_item_id, source, source_ref, amount, currency,
            observed_on, accuracy, where_text, created_at
          )
          VALUES (
            1000000, ${item}, 'openPrices', '1098', 1, 'EUR', '2026-09-01',
            90, 'Store', now()
          )
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    it.effect("upserts prices and deletes them with their item", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const item = yield* insertFoodItem(sql, { sourceRef: "upsert-item" });
        const kept = yield* insertFoodItem(sql, { sourceRef: "upsert-kept" });
        const id = yield* insertFoodPrice(sql, {
          foodItemId: item,
          source: "estimate",
          sourceRef: "estimate",
          amount: 2,
        });
        yield* insertFoodPrice(sql, { foodItemId: kept, sourceRef: "2001" });

        // Estimating again replaces the estimate.
        const [upserted] = yield* sql<{
          readonly id: string;
          readonly amount: string;
        }>`
          INSERT INTO food_prices (
            food_item_id, source, source_ref, amount, currency, observed_on,
            accuracy, where_text, created_at
          )
          VALUES (
            ${item}, 'estimate', 'estimate', 3.5, 'EUR', '2026-10-01', 40,
            'Estimate', now()
          )
          ON CONFLICT ON CONSTRAINT food_prices_food_item_id_source_source_ref_key
          DO UPDATE SET amount = excluded.amount,
            observed_on = excluded.observed_on
          RETURNING id, amount::text AS amount
        `;
        assert.deepStrictEqual(
          { id: String(upserted.id), amount: upserted.amount },
          { id, amount: "3.50" },
        );

        yield* sql`DELETE FROM food_items WHERE id = ${item}`;
        const remaining = yield* sql<{ readonly foodItemId: string }>`
          SELECT food_item_id FROM food_prices
          WHERE food_item_id IN (${item}, ${kept})
        `;
        assert.deepStrictEqual(
          remaining.map((row) => row.foodItemId),
          [kept],
        );
      }),
    );

    it.effect("reads an item's latest prices with the price index", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const item = yield* insertFoodItem(sql, { sourceRef: "latest-item" });
        for (const [sourceRef, observedOn] of [
          ["3001", "2026-07-01"],
          ["3002", "2026-09-01"],
          ["3003", "2026-08-01"],
        ] as const) {
          yield* insertFoodPrice(sql, {
            foodItemId: item,
            sourceRef,
            observedOn,
          });
        }
        const rows = yield* sql<{ readonly sourceRef: string }>`
          SELECT source_ref FROM food_prices
          WHERE food_item_id = ${item}
          ORDER BY observed_on DESC
        `;
        assert.deepStrictEqual(
          rows.map((row) => row.sourceRef),
          ["3002", "3003", "3001"],
        );

        const text = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM food_prices
            WHERE food_item_id = '00000000-0000-4000-8000-000000000f02'
            ORDER BY observed_on DESC
          `,
        );
        assert.include(text, "food_prices_food_item_id_observed_on_idx");
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("accepts valid import jobs and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const at = (minute: number) =>
          `2026-01-01T00:${String(minute).padStart(2, "0")}:00Z`;
        // Every status, with the timestamps it needs. Terminal jobs don't
        // count as active, so they don't collide with each other.
        yield* insertFoodImport(sql, { source: "openPrices" });
        yield* insertFoodImport(sql, {
          source: "statsNz",
          status: "running",
          startedAt: at(1),
        });
        yield* insertFoodImport(sql, {
          status: "succeeded",
          startedAt: at(1),
          finishedAt: at(2),
          items: 10,
          prices: 20,
        });
        yield* insertFoodImport(sql, {
          status: "failed",
          startedAt: at(0),
          finishedAt: at(0),
          error: "😀".repeat(200),
        });
        // A queued job may fail without having started.
        yield* insertFoodImport(sql, {
          country: "NZ",
          source: "priceEstimates",
          status: "failed",
          finishedAt: at(1),
          error: "Cancelled",
        });

        const cases = [
          [{ country: "AT" }, "food_imports_country_check"],
          [{ source: "openFoodFacts" }, "food_imports_source_check"],
          [{ source: "estimate" }, "food_imports_source_check"],
          [{ status: "done" }, "food_imports_status_check"],
          [{ status: "Queued" }, "food_imports_status_check"],
          [{ items: -1 }, "food_imports_items_check"],
          [{ prices: -1 }, "food_imports_prices_check"],
          [{ error: "e".repeat(201) }, "food_imports_error_check"],
          // Running without started_at.
          [{ status: "running" }, "food_imports_lifecycle_check"],
          // Ended without finished_at.
          [
            { status: "succeeded", startedAt: at(1) },
            "food_imports_lifecycle_check",
          ],
          [{ status: "failed" }, "food_imports_lifecycle_check"],
          // finished_at while still active.
          [{ finishedAt: at(1) }, "food_imports_lifecycle_check"],
          [
            { status: "running", startedAt: at(1), finishedAt: at(2) },
            "food_imports_lifecycle_check",
          ],
          // Out of order.
          [
            {
              status: "running",
              requestedAt: at(5),
              startedAt: at(4),
            },
            "food_imports_lifecycle_check",
          ],
          [
            {
              status: "succeeded",
              startedAt: at(5),
              finishedAt: at(4),
            },
            "food_imports_lifecycle_check",
          ],
          [
            { status: "failed", requestedAt: at(5), finishedAt: at(4) },
            "food_imports_lifecycle_check",
          ],
          [
            {
              status: "succeeded",
              startedAt: at(1),
              finishedAt: at(2),
              requestedBy: "00000000-0000-4000-8000-000000000f03",
            },
            "food_imports_requested_by_fkey",
          ],
        ] as const;
        for (const [job, constraint] of cases) {
          yield* expectViolation(
            insertFoodImport(sql, {
              country: "DE",
              source: "priceEstimates",
              ...job,
            }),
            constraint,
          );
        }
      }),
    );

    it.effect("allows one active import per country and source", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const user = yield* insertUser(sql, "food-import-requester");
        const queued = yield* insertFoodImport(sql, {
          country: "NZ",
          source: "statsNz",
          requestedBy: user,
        });
        // Another source or country may run at the same time.
        yield* insertFoodImport(sql, {
          country: "NZ",
          source: "priceEstimates",
          status: "running",
          startedAt: "2026-01-01T00:00:00Z",
        });
        yield* insertFoodImport(sql, { country: "NZ", source: "openPrices" });

        for (const status of ["queued", "running"]) {
          yield* expectViolation(
            insertFoodImport(sql, {
              country: "NZ",
              source: "statsNz",
              status,
              startedAt: "2026-01-01T00:00:00Z",
            }),
            "food_imports_active_key",
          );
        }
        // Starting the job keeps it active.
        yield* sql`
          UPDATE food_imports
          SET status = 'running', started_at = '2026-01-01T00:01:00Z'
          WHERE id = ${queued}
        `;
        yield* expectViolation(
          insertFoodImport(sql, { country: "NZ", source: "statsNz" }),
          "food_imports_active_key",
        );

        // Once it ended, a new one can be requested.
        yield* sql`
          UPDATE food_imports
          SET status = 'succeeded', finished_at = '2026-01-01T00:02:00Z'
          WHERE id = ${queued}
        `;
        yield* insertFoodImport(sql, { country: "NZ", source: "statsNz" });

        // The job outlives the user who requested it.
        yield* sql`DELETE FROM users WHERE id = ${user}`;
        const [job] = yield* sql<{ readonly requestedBy: string | null }>`
          SELECT requested_by FROM food_imports WHERE id = ${queued}
        `;
        assert.deepStrictEqual(job, { requestedBy: null });
      }),
    );

    it.effect("accepts valid meal plans and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "meal-plans-check");
        yield* insertMealPlan(sql, { userId });
        yield* insertMealPlan(sql, { userId, ...readyMealPlan });
        // The limits, in New Zealand.
        yield* insertMealPlan(sql, {
          userId,
          ...readyMealPlan,
          country: "NZ",
          currency: "NZD",
          totalCost: 0,
          cheapestTotal: "9999999999.99",
          estimatedShare: 100,
          accuracy: 0,
          model: "😀".repeat(100),
          finishedAt: "2026-01-01T00:00:00Z",
        });
        yield* insertMealPlan(sql, {
          userId,
          ...readyMealPlan,
          cheapestTotal: 0,
          estimatedShare: 0,
          accuracy: 100,
        });
        // Failed plans, with or without what the planner got to.
        for (const failureReason of [
          "noCandidates",
          "overBudget",
          "invalidPlan",
          "plannerFailed",
        ]) {
          yield* insertMealPlan(sql, {
            userId,
            status: "failed",
            failureReason,
            finishedAt: readyMealPlan.finishedAt,
          });
        }
        yield* insertMealPlan(sql, {
          userId,
          ...readyMealPlan,
          status: "failed",
          cheapestTotal: 80,
          failureReason: "overBudget",
        });
        // A pending plan may already know its cheapest total.
        yield* insertMealPlan(sql, { userId, cheapestTotal: 10 });

        const failed = {
          status: "failed",
          failureReason: "plannerFailed",
          finishedAt: readyMealPlan.finishedAt,
        } as const;
        const cases = [
          [{ country: "AT" }, "meal_plans_country_check"],
          [{ country: "AT", currency: "EUR" }, "meal_plans_country_check"],
          [{ currency: "USD" }, "meal_plans_country_currency_check"],
          [{ currency: "NZD" }, "meal_plans_country_currency_check"],
          [
            { country: "NZ", currency: "EUR" },
            "meal_plans_country_currency_check",
          ],
          [{ status: "done" }, "meal_plans_status_check"],
          [{ request: [] }, "meal_plans_request_check"],
          [{ request: "days" }, "meal_plans_request_check"],
          [{ ...readyMealPlan, plan: [] }, "meal_plans_plan_check"],
          [{ ...readyMealPlan, totalCost: -1 }, "meal_plans_total_cost_check"],
          [{ cheapestTotal: -1 }, "meal_plans_cheapest_total_check"],
          [
            { ...readyMealPlan, estimatedShare: -1 },
            "meal_plans_estimated_share_check",
          ],
          [
            { ...readyMealPlan, estimatedShare: 101 },
            "meal_plans_estimated_share_check",
          ],
          [{ ...readyMealPlan, accuracy: -1 }, "meal_plans_accuracy_check"],
          [{ ...readyMealPlan, accuracy: 101 }, "meal_plans_accuracy_check"],
          [{ ...readyMealPlan, model: "" }, "meal_plans_model_check"],
          [
            { ...readyMealPlan, model: "m".repeat(101) },
            "meal_plans_model_check",
          ],
          [
            { ...failed, failureReason: "timeout" },
            "meal_plans_failure_reason_check",
          ],
          [
            { ...readyMealPlan, finishedAt: "2025-12-31T23:59:59Z" },
            "meal_plans_finished_at_check",
          ],
          // Pending with a result.
          [{ plan: readyMealPlan.plan }, "meal_plans_pending_check"],
          [
            { finishedAt: readyMealPlan.finishedAt },
            "meal_plans_pending_check",
          ],
          [{ failureReason: "overBudget" }, "meal_plans_pending_check"],
          // Ready without every result, or with a failure.
          [{ ...readyMealPlan, plan: null }, "meal_plans_ready_check"],
          [{ ...readyMealPlan, totalCost: null }, "meal_plans_ready_check"],
          [
            { ...readyMealPlan, estimatedShare: null },
            "meal_plans_ready_check",
          ],
          [{ ...readyMealPlan, accuracy: null }, "meal_plans_ready_check"],
          [{ ...readyMealPlan, model: null }, "meal_plans_ready_check"],
          [{ ...readyMealPlan, finishedAt: null }, "meal_plans_ready_check"],
          [
            { ...readyMealPlan, failureReason: "overBudget" },
            "meal_plans_ready_check",
          ],
          // Failed without a reason or an end.
          [{ ...failed, failureReason: null }, "meal_plans_failed_check"],
          [{ ...failed, finishedAt: null }, "meal_plans_failed_check"],
          [
            { userId: "00000000-0000-4000-8000-000000000f04" },
            "meal_plans_user_id_fkey",
          ],
        ] as const;
        for (const [mealPlan, constraint] of cases) {
          yield* expectViolation(
            insertMealPlan(sql, { userId, ...mealPlan }),
            constraint,
          );
        }
      }),
    );

    it.effect("finishes a pending meal plan", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "meal-plans-finish");
        const id = yield* insertMealPlan(sql, { userId });
        // Setting the status alone is not enough.
        yield* expectViolation(
          sql`UPDATE meal_plans SET status = 'ready' WHERE id = ${id}`,
          "meal_plans_ready_check",
        );
        yield* sql`
          UPDATE meal_plans
          SET status = 'ready', plan = '{"days": []}', total_cost = 12.3,
            estimated_share = 50, accuracy = 60, model = 'model-1',
            finished_at = '2026-01-01T00:00:30Z'
          WHERE id = ${id}
        `;
        const [plan] = yield* sql<{
          readonly status: string;
          readonly totalCost: string;
        }>`
          SELECT status, total_cost::text AS total_cost
          FROM meal_plans WHERE id = ${id}
        `;
        assert.deepStrictEqual(plan, { status: "ready", totalCost: "12.30" });
      }),
    );

    it.effect("lists and counts a user's plans with the user index", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const deleted = yield* insertUser(sql, "meal-plans-deleted");
        const kept = yield* insertUser(sql, "meal-plans-kept");
        for (const createdAt of [
          "2026-01-01T00:00:00Z",
          "2026-01-03T00:00:00Z",
          "2026-01-02T12:00:00Z",
        ]) {
          yield* insertMealPlan(sql, { userId: kept, createdAt });
        }
        yield* insertMealPlan(sql, { userId: deleted });

        const rows = yield* sql<{ readonly createdAt: Date }>`
          SELECT created_at FROM meal_plans
          WHERE user_id = ${kept}
          ORDER BY created_at DESC
        `;
        assert.deepStrictEqual(
          rows.map((row) => new Date(row.createdAt).toISOString()),
          [
            "2026-01-03T00:00:00.000Z",
            "2026-01-02T12:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
          ],
        );
        // The rate limit: the plans of the last 24 hours.
        const [recent] = yield* sql<{ readonly count: number }>`
          SELECT count(*)::int AS count FROM meal_plans
          WHERE user_id = ${kept}
            AND created_at > '2026-01-03T00:00:00Z'::timestamptz
              - interval '24 hours'
        `;
        assert.strictEqual(recent.count, 2);

        const listing = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT id FROM meal_plans
            WHERE user_id = '00000000-0000-4000-8000-000000000f05'
            ORDER BY created_at DESC
          `,
        );
        assert.include(listing, "meal_plans_user_id_created_at_idx");
        assert.notInclude(listing, "Sort");
        const count = yield* explain(
          sql,
          sql`
            EXPLAIN
            SELECT count(*) FROM meal_plans
            WHERE user_id = '00000000-0000-4000-8000-000000000f05'
              AND created_at > '2026-01-01T00:00:00Z'
          `,
        );
        assert.include(count, "meal_plans_user_id_created_at_idx");

        // A user's plans go with the account.
        yield* sql`DELETE FROM users WHERE id = ${deleted}`;
        const remaining = yield* sql<{ readonly userId: string }>`
          SELECT DISTINCT user_id FROM meal_plans
          WHERE user_id IN (${deleted}, ${kept})
        `;
        assert.deepStrictEqual(
          remaining.map((row) => row.userId),
          [kept],
        );
      }),
    );
  });
});
