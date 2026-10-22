import { assert, describe, it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { FoodCommands } from "#domains/food/FoodCommands";
import type { JsonRequest } from "#infrastructure/Claude";
import type { OpenPrice } from "#infrastructure/OpenPrices";
import type { AveragePrice } from "#infrastructure/StatsNz";
import { type Json, makeBlogApp } from "#testing/Blogs";
import { fakeFoodSources, makeScriptedClaude } from "#testing/Food";

/** An id nothing has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

const groceries = [
  "Bananas, 1kg",
  "Apples, 1kg",
  "Oranges, 1kg",
  "Carrots, 1kg",
  "Potatoes, 1kg",
  "Onions, 1kg",
  "Tomatoes, 1kg",
  "Broccoli, 1kg",
  "Cabbage, 1kg",
  "Mushrooms, 1kg",
  "Kumara, 1kg",
  "Pumpkin, 1kg",
  "Rice - long grain, white (supermarket only), 1kg",
  "Flour - white (supermarket only), 1.5kg",
  "Milk - standard homogenised, 2 litres",
  "Eggs, dozen",
  "Butter - salted, 500g",
  "Cheese - mild cheddar (supermarket only), 1kg",
  "Chicken breast, 1kg",
  "Beef - mince, 1kg",
];

const statsNz: ReadonlyArray<AveragePrice> = [
  ...groceries.map((title, index) => ({
    series: `CPIM.SAP${String(index + 100).padStart(4, "0")}`,
    title,
    month: "2026-09",
    price: 2 + index / 10,
  })),
  // Not a grocery: stored, but never planned with.
  {
    series: "CPIM.SAP0300",
    title: "Fish and chips, One fish/chips",
    month: "2026-09",
    price: 12,
  },
];

const location = { id: 1, name: "Lidl", city: "Berlin" };
const openPrices: ReadonlyArray<OpenPrice> = [
  {
    id: 101,
    code: null,
    category: "en:broccoli",
    price: 3.9,
    discounted: false,
    per: "kilogram",
    currency: "EUR",
    date: "2026-09-20",
    location,
  },
  {
    id: 102,
    code: "4047247192637",
    category: null,
    price: 1.25,
    discounted: true,
    per: null,
    currency: "EUR",
    date: "2026-09-21",
    location,
  },
];

const walnuts = {
  code: "4047247192637",
  name: "Walnusskerne",
  brand: "Trader Joe's",
  quantity: { amount: 500, unit: "g" as const },
  categories: ["en:nuts"],
  labels: [],
  ingredientsAnalysis: ["en:vegan", "en:vegetarian"],
  ingredients: ["en:walnut"],
  allergens: ["en:nuts"],
};
const oats = {
  ...walnuts,
  code: "20003166",
  name: "Haferflocken",
  brand: null,
  categories: ["en:oat-flakes"],
  ingredients: ["en:oat"],
  allergens: ["en:gluten"],
};

/** A week of dinners from the first food in the prompt. */
const dinners = (request: JsonRequest<unknown>) => {
  const ref = /^(f\d+) \|/mu.exec(request.turns[0]!.content)![1]!;
  return {
    days: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      meals: [
        {
          slot: "dinner",
          name: `Dinner ${index + 1}`,
          description: "Cook it.",
          ingredients: [{ ref, amount: 300 }],
        },
      ],
    })),
    notes: "Buy once.",
  };
};

const planRequest = {
  country: "NZ",
  people: 2,
  meals: ["dinner"],
  diet: "omnivore",
};

const setup = (
  options: {
    readonly answers?: ReadonlyArray<unknown>;
    readonly configured?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    // Requests run on the real clock, the background jobs on the test
    // clock: set it to now, or the jobs see every message as due in
    // decades. Before the app is built: a jump that size would also run
    // every hourly cleanup once per hour since 1970.
    yield* TestClock.setTime(Date.now());
    const claude = makeScriptedClaude(options.answers ?? [], {
      configured: options.configured ?? true,
    });
    const app = yield* makeBlogApp({
      foodSources: fakeFoodSources({
        statsNz,
        openPrices,
        products: [walnuts, oats],
      }),
      claude: claude.layer,
    });
    const cook = yield* app.member("cook", "foodPlanner");
    const other = yield* app.member("other-cook", "foodPlanner");

    /**
     * Lets the background jobs run until `done` holds: moves the test
     * clock past the outbox's polling pause and gives the database time.
     */
    const settle = <A>(read: Effect.Effect<A>, done: (value: A) => boolean) =>
      Effect.gen(function* () {
        for (let round = 0; round < 40; round++) {
          const value = yield* read;
          if (done(value)) return value;
          // Ahead of the real clock, so a job never finishes "before" a
          // request (made on the real clock) created its row.
          const testNow = yield* Clock.currentTimeMillis;
          yield* TestClock.setTime(Math.max(testNow, Date.now()) + 6000);
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 25)),
          );
        }
        return assert.fail("The background job did not finish");
      });

    const startImport = (country: string, source: string) =>
      app.expect(202, cook.cookie, "POST", "/food/imports", {
        body: { country, source },
      });

    const importDone = (id: unknown) =>
      settle(
        app.expect(200, cook.cookie, "GET", `/food/imports/${String(id)}`),
        (body) => ["succeeded", "failed"].includes(String(body.status)),
      );

    const search = (query: string) =>
      app
        .expect(200, cook.cookie, "GET", `/food/items?${query}`)
        .pipe(
          Effect.map((body) => body.items as unknown as ReadonlyArray<Json>),
        );

    const plan = (cookie: string, id: unknown) =>
      app.expect(200, cookie, "GET", `/food/meal-plans/${String(id)}`);

    const planDone = (id: unknown) =>
      settle(plan(cook.cookie, id), (body) => body.status !== "pending");

    const importNz = Effect.gen(function* () {
      const started = yield* startImport("NZ", "statsNz");
      return yield* importDone(started.id);
    });

    return {
      ...app,
      claude,
      cook,
      other,
      settle,
      startImport,
      importDone,
      search,
      plan,
      planDone,
      importNz,
    };
  });

describe("food planner access", () => {
  it.effect("needs a session (401) and the foodPlanner role (403)", () =>
    Effect.gen(function* () {
      const { call, user } = yield* setup();
      assert.strictEqual(
        (yield* call(undefined, "GET", "/food/sources")).status,
        401,
      );
      assert.strictEqual(
        (yield* call(user.cookie, "GET", "/food/sources")).status,
        403,
      );
      const post = yield* call(user.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      assert.strictEqual(post.status, 403);
    }),
  );

  it.effect("lists the data sources with their licences, uncached", () =>
    Effect.gen(function* () {
      const { call, cook } = yield* setup();
      const response = yield* call(cook.cookie, "GET", "/food/sources");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      const sources = (yield* Effect.promise(() =>
        response.json(),
      )) as Array<Json>;
      assert.includeMembers(
        sources.map((source) => source.id),
        ["openFoodFacts", "openPrices", "statsNz", "estimate"],
      );
    }),
  );
});

describe("food imports", () => {
  it.effect("imports Stats NZ prices for New Zealand", () =>
    Effect.gen(function* () {
      const { expect, cook, startImport, importDone, search } = yield* setup();
      const started = yield* startImport("NZ", "statsNz");
      assert.strictEqual(started.status, "queued");
      // One import of a kind at a time.
      const again = yield* expect(409, cook.cookie, "POST", "/food/imports", {
        body: { country: "NZ", source: "statsNz" },
      });
      assert.strictEqual(again.importId, started.id);

      const done = yield* importDone(started.id);
      assert.strictEqual(done.status, "succeeded");
      assert.strictEqual(done.items, statsNz.length);
      assert.strictEqual(done.prices, statsNz.length);
      const listed = yield* expect(200, cook.cookie, "GET", "/food/imports");
      assert.strictEqual((listed as unknown as Array<Json>)[0]?.id, started.id);

      const [eggs] = yield* search("country=NZ&q=eggs");
      assert.strictEqual(eggs?.name, "Eggs, dozen");
      assert.deepStrictEqual(eggs?.quantity, { amount: 12, unit: "piece" });
      assert.strictEqual(eggs?.vegetarian, true);
      assert.strictEqual(eggs?.vegan, false);
      const price = eggs?.bestPrice as Json;
      assert.strictEqual(price.source, "statsNz");
      assert.strictEqual(price.currency, "NZD");
      assert.include(String(price.where), "Stats NZ");

      const details = yield* expect(
        200,
        cook.cookie,
        "GET",
        `/food/items/${String(eggs?.id)}`,
      );
      assert.lengthOf(details.prices as Array<Json>, 1);
      yield* expect(404, cook.cookie, "GET", `/food/items/${unknownId}`);
      yield* expect(404, cook.cookie, "GET", `/food/imports/${unknownId}`);
    }),
  );

  it.effect("refuses Stats NZ for Germany (422)", () =>
    Effect.gen(function* () {
      const { expect, cook } = yield* setup();
      yield* expect(422, cook.cookie, "POST", "/food/imports", {
        body: { country: "DE", source: "statsNz" },
      });
    }),
  );

  it.effect(
    "imports Open Prices for Germany with the products from Open Food Facts",
    () =>
      Effect.gen(function* () {
        const { startImport, importDone, search } = yield* setup();
        const done = yield* importDone(
          (yield* startImport("DE", "openPrices")).id,
        );
        assert.strictEqual(done.status, "succeeded");
        assert.strictEqual(done.prices, 2);

        const [broccoli] = yield* search("country=DE&q=broccoli");
        assert.strictEqual(broccoli?.name, "Broccoli, 1kg");
        assert.strictEqual((broccoli!.bestPrice as Json).where, "Lidl, Berlin");

        const [nuts] = yield* search("country=DE&q=walnuss");
        assert.strictEqual(nuts?.brand, "Trader Joe's");
        assert.strictEqual(nuts?.vegan, true);
        const price = nuts?.bestPrice as Json;
        // A discounted price is a promotion: less accurate.
        assert.isTrue(price.discounted);
        assert.isBelow(Number(price.accuracy), 85);
      }),
  );

  it.effect("looks products up on Open Food Facts when asked to", () =>
    Effect.gen(function* () {
      const { search } = yield* setup();
      assert.lengthOf(yield* search("country=DE&q=haferflocken"), 0);
      const found = yield* search("country=DE&q=haferflocken&lookup=true");
      assert.strictEqual(found[0]?.name, "Haferflocken");
      assert.isNull(found[0]?.bestPrice);
      // Stored: found without asking again, but not when only priced ones are wanted.
      assert.lengthOf(yield* search("country=DE&q=haferflocken"), 1);
      assert.lengthOf(
        yield* search("country=DE&q=haferflocken&priced=true"),
        0,
      );
      assert.lengthOf(
        yield* search("country=DE&q=haferflocken&priced=false"),
        1,
      );
    }),
  );
});

describe("meal plans", () => {
  it.effect("answers 503 without Claude", () =>
    Effect.gen(function* () {
      const { expect, cook } = yield* setup({ configured: false });
      yield* expect(503, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
    }),
  );

  it.effect("writes a plan in the background, for its owner only", () =>
    Effect.gen(function* () {
      const { expect, cook, other, importNz, planDone, claude } = yield* setup({
        answers: [dinners],
      });
      yield* importNz;
      const pending = yield* expect(
        202,
        cook.cookie,
        "POST",
        "/food/meal-plans",
        {
          body: { ...planRequest, exclude: ["fish"] },
        },
      );
      assert.strictEqual(pending.status, "pending");
      assert.deepStrictEqual(pending.days, []);

      const ready = yield* planDone(pending.id);
      assert.strictEqual(ready.status, "ready", JSON.stringify(ready.failure));
      assert.lengthOf(ready.days as Array<Json>, 7);
      const [entry] = ready.shoppingList as Array<Json>;
      // 7 dinners of 300 in the first food's unit.
      assert.strictEqual((entry!.needed as Json).amount, 2100);
      assert.strictEqual(ready.totalCost, entry?.cost);
      assert.strictEqual(ready.model, "claude-test");
      assert.strictEqual(ready.notes, "Buy once.");
      assert.isNumber(ready.accuracy);

      // Takeaway food is never offered; neither is what the user excluded.
      const prompt = claude.requests[0]!.turns[0]!.content;
      assert.notInclude(prompt, "Fish and chips");
      assert.include(prompt, 'Excluded foods: "fish"');

      yield* expect(
        404,
        other.cookie,
        "GET",
        `/food/meal-plans/${String(pending.id)}`,
      );
      const mine = yield* expect(200, cook.cookie, "GET", "/food/meal-plans");
      const theirs = yield* expect(
        200,
        other.cookie,
        "GET",
        "/food/meal-plans",
      );
      assert.lengthOf(mine as unknown as Array<Json>, 1);
      assert.lengthOf(theirs as unknown as Array<Json>, 0);

      yield* expect(
        404,
        other.cookie,
        "DELETE",
        `/food/meal-plans/${String(pending.id)}`,
      );
      yield* expect(
        204,
        cook.cookie,
        "DELETE",
        `/food/meal-plans/${String(pending.id)}`,
      );
      yield* expect(
        404,
        cook.cookie,
        "GET",
        `/food/meal-plans/${String(pending.id)}`,
      );
    }),
  );

  it.effect("fails a plan when there are too few priced foods", () =>
    Effect.gen(function* () {
      const { expect, cook, planDone } = yield* setup({ answers: [dinners] });
      const pending = yield* expect(
        202,
        cook.cookie,
        "POST",
        "/food/meal-plans",
        {
          body: planRequest,
        },
      );
      const failed = yield* planDone(pending.id);
      assert.strictEqual(failed.status, "failed");
      assert.deepStrictEqual(failed.failure, {
        reason: "noCandidates",
        cheapestTotal: null,
      });
    }),
  );

  it.effect("limits pending plans per user (429)", () =>
    Effect.gen(function* () {
      const { expect, cook, other } = yield* setup();
      yield* expect(202, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      yield* expect(202, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      yield* expect(429, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      // Per user.
      yield* expect(202, other.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
    }),
  );

  it.effect("keeps the limit for requests sent at once", () =>
    Effect.gen(function* () {
      const { call, cook } = yield* setup();
      const responses = yield* Effect.all(
        Array.from({ length: 5 }, () =>
          call(cook.cookie, "POST", "/food/meal-plans", { body: planRequest }),
        ),
        { concurrency: "unbounded" },
      );
      const statuses = responses.map((response) => response.status).sort();
      assert.deepStrictEqual(statuses, [202, 202, 429, 429, 429]);
    }),
  );

  it.effect(
    "drops a plan whose owner lost the role, without asking Claude",
    () =>
      Effect.gen(function* () {
        const { expect, cook, settle, sql, claude } = yield* setup({
          answers: [dinners],
        });
        const pending = yield* expect(
          202,
          cook.cookie,
          "POST",
          "/food/meal-plans",
          {
            body: planRequest,
          },
        );
        yield* sql(
          (sql) => sql`
          DELETE FROM user_roles WHERE user_id = ${cook.id} AND role = 'foodPlanner'
        `,
        );
        yield* expect(
          403,
          cook.cookie,
          "GET",
          `/food/meal-plans/${String(pending.id)}`,
        );
        // Read directly: the owner can't any more.
        const [row] = yield* settle(
          sql(
            (sql) => sql<{
              readonly status: string;
              readonly failureReason: string | null;
            }>`
            SELECT status, failure_reason FROM meal_plans
            WHERE id = ${String(pending.id)}
          `,
          ),
          ([row]) => row?.status !== "pending",
        );
        assert.deepStrictEqual(row, {
          status: "failed",
          failureReason: "plannerFailed",
        });
        assert.lengthOf(claude.requests, 0);
      }),
  );

  it.effect("deletes the plans of deleted accounts", () =>
    Effect.gen(function* () {
      const { expect, cook, other, services, sql } = yield* setup();
      yield* expect(202, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      yield* expect(202, other.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      yield* expect(204, cook.cookie, "POST", "/account/delete");
      const deleted = yield* Effect.gen(function* () {
        const commands = yield* FoodCommands;
        return yield* commands.forgetDeletedUsers;
      }).pipe(Effect.provide(services));
      assert.strictEqual(deleted, 1);
      const left = yield* sql(
        (sql) =>
          sql<{ readonly userId: string }>`SELECT user_id FROM meal_plans`,
      );
      assert.deepStrictEqual(
        left.map((row) => row.userId),
        [other.id],
      );
    }),
  );
});
