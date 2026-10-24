import { assert, describe, it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { FoodCommands } from "#domains/food/FoodCommands";
import { ClaudeFailed, type JsonRequest } from "#infrastructure/Claude";
import type { OpenPrice } from "#infrastructure/OpenPrices";
import type { AveragePrice } from "#infrastructure/StatsNz";
import { type Json, makeBlogApp } from "#testing/Blogs";
import { insertMealPlanCredits, mealPlanBalance } from "#testing/Credits";
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

describe("meal plans paid with credits", () => {
  /**
   * The food setup plus `buyer`, a `mealPlanBuyer` with `credits` meal-plan
   * credits (granted as a paid purchase would), and the readers of credits.
   */
  const setupBuyer = (
    credits: number,
    options: Parameters<typeof setup>[0] = {},
  ) =>
    Effect.gen(function* () {
      const food = yield* setup(options);
      const buyer = yield* food.member("buyer", "mealPlanBuyer");
      if (credits > 0) {
        yield* insertMealPlanCredits(buyer.id, credits).pipe(
          Effect.provide(food.services),
        );
      }
      const balance = (id: string) =>
        mealPlanBalance(id).pipe(Effect.provide(food.services));
      const create = (cookie: string) =>
        food.call(cookie, "POST", "/food/meal-plans", { body: planRequest });
      const settled = (cookie: string, id: unknown) =>
        food.settle(food.plan(cookie, id), (body) => body.status !== "pending");
      return { ...food, buyer, balance, create, settled };
    });

  it.effect("answers 402 NoCreditsLeft to a buyer without credits", () =>
    Effect.gen(function* () {
      const { buyer, create, sql } = yield* setupBuyer(0);
      const response = yield* create(buyer.cookie);
      assert.strictEqual(response.status, 402);
      const body = (yield* Effect.promise(() => response.json())) as Json;
      assert.strictEqual(body._tag, "NoCreditsLeft");
      assert.strictEqual(body.feature, "mealPlan");
      const plans = yield* sql(
        (sql) => sql`SELECT id FROM meal_plans WHERE user_id = ${buyer.id}`,
      );
      assert.lengthOf(plans, 0);
    }),
  );

  it.effect(
    "uses a credit for a plan, and answers 402 once they are used",
    () =>
      Effect.gen(function* () {
        const { buyer, balance, create, expect } = yield* setupBuyer(1);
        const pending = yield* expect(
          202,
          buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        assert.strictEqual(pending.status, "pending");
        assert.deepStrictEqual(yield* balance(buyer.id), {
          available: 0,
          used: 1,
        });
        assert.strictEqual((yield* create(buyer.cookie)).status, 402);
        assert.deepStrictEqual(yield* balance(buyer.id), {
          available: 0,
          used: 1,
        });
      }),
  );

  it.effect("uses the credit that stays with the plan once it is written", () =>
    Effect.gen(function* () {
      const { buyer, balance, expect, importNz, settled } = yield* setupBuyer(
        2,
        { answers: [dinners] },
      );
      yield* importNz;
      const pending = yield* expect(
        202,
        buyer.cookie,
        "POST",
        "/food/meal-plans",
        { body: planRequest },
      );
      const ready = yield* settled(buyer.cookie, pending.id);
      assert.strictEqual(ready.status, "ready", JSON.stringify(ready.failure));
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 1,
        used: 1,
      });
    }),
  );

  it.effect("uses no credit for a foodPlanner", () =>
    Effect.gen(function* () {
      const { cook, balance, expect, services } = yield* setupBuyer(0);
      // Credits next to the role are for when the role goes.
      yield* insertMealPlanCredits(cook.id, 1).pipe(Effect.provide(services));
      yield* expect(202, cook.cookie, "POST", "/food/meal-plans", {
        body: planRequest,
      });
      assert.deepStrictEqual(yield* balance(cook.id), {
        available: 1,
        used: 0,
      });
    }),
  );

  it.effect("uses a credit for a buyer, though a foodPlanner needs none", () =>
    Effect.gen(function* () {
      const { cook, buyer, balance, create } = yield* setupBuyer(1);
      assert.strictEqual((yield* create(cook.cookie)).status, 202);
      assert.strictEqual((yield* create(buyer.cookie)).status, 202);
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 0,
        used: 1,
      });
    }),
  );

  it.effect("uses no credit for a request that is rate limited", () =>
    Effect.gen(function* () {
      const { buyer, balance, create } = yield* setupBuyer(3);
      assert.strictEqual((yield* create(buyer.cookie)).status, 202);
      assert.strictEqual((yield* create(buyer.cookie)).status, 202);
      assert.strictEqual((yield* create(buyer.cookie)).status, 429);
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 1,
        used: 2,
      });
    }),
  );

  it.effect("uses no credit for a request without Claude (503)", () =>
    Effect.gen(function* () {
      const { buyer, balance, create } = yield* setupBuyer(1, {
        configured: false,
      });
      assert.strictEqual((yield* create(buyer.cookie)).status, 503);
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 1,
        used: 0,
      });
    }),
  );

  it.effect("uses one credit once for requests sent at once", () =>
    Effect.gen(function* () {
      const { buyer, balance, create, sql } = yield* setupBuyer(1);
      const responses = yield* Effect.all(
        Array.from({ length: 3 }, () => create(buyer.cookie)),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(
        responses.map((response) => response.status).sort(),
        [202, 402, 402],
      );
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 0,
        used: 1,
      });
      const plans = yield* sql(
        (sql) => sql`SELECT id FROM meal_plans WHERE user_id = ${buyer.id}`,
      );
      assert.lengthOf(plans, 1);
    }),
  );

  it.effect("gives the credit back when the plan fails", () =>
    Effect.gen(function* () {
      // No food data: the plan fails with noCandidates.
      const { buyer, balance, expect, settled } = yield* setupBuyer(1, {
        answers: [dinners],
      });
      const pending = yield* expect(
        202,
        buyer.cookie,
        "POST",
        "/food/meal-plans",
        { body: planRequest },
      );
      const failed = yield* settled(buyer.cookie, pending.id);
      assert.strictEqual(failed.status, "failed");
      assert.deepStrictEqual(failed.failure, {
        reason: "noCandidates",
        cheapestTotal: null,
      });
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 1,
        used: 0,
      });
    }),
  );

  describe("a plan that fails", () => {
    /** Plans once with `answers` for Claude and answers how it ended. */
    const planEnds = (
      answers: ReadonlyArray<unknown>,
      body: Json = planRequest,
    ) =>
      Effect.gen(function* () {
        const t = yield* setupBuyer(1, { answers });
        yield* t.importNz;
        const pending = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body },
        );
        const ended = yield* t.settled(t.buyer.cookie, pending.id);
        const [row] = yield* t.sql(
          (sql) => sql<{ readonly started: boolean }>`
            SELECT started_at IS NOT NULL AS started FROM meal_plans
            WHERE id = ${String(pending.id)}
          `,
        );
        return {
          ended,
          started: row?.started,
          balance: yield* t.balance(t.buyer.id),
        };
      });

    const given = { available: 1, used: 0 };
    const kept = { available: 0, used: 1 };

    // Claude was never reached, or answered with an error before working.
    it.effect.each([
      "transport",
      "unconfigured",
      "api:429",
      "api:500",
      "api:503",
    ])("gives the credit back when Claude fails with %s", (reason) =>
      Effect.gen(function* () {
        const result = yield* planEnds([new ClaudeFailed({ reason })]);
        assert.strictEqual(result.ended.status, "failed");
        assert.deepStrictEqual(result.balance, given);
        // The job did start: only the cost of the failure decides.
        assert.isTrue(result.started);
      }),
    );

    // Claude may have worked, or the request may have been made to fail.
    it.effect.each([
      "refusal",
      "max_tokens",
      "output",
      "api:400",
      "api:401",
      "api:404",
      "timeout",
      "unknown",
      "api:unknown",
    ])("keeps the credit used when Claude fails with %s", (reason) =>
      Effect.gen(function* () {
        const result = yield* planEnds([new ClaudeFailed({ reason })]);
        assert.strictEqual(result.ended.status, "failed");
        assert.deepStrictEqual(result.balance, kept);
        assert.isTrue(result.started);
      }),
    );

    it.effect.each(["transport", "api:429", "api:503"])(
      "keeps the credit used when a retry fails with %s",
      (reason) =>
        Effect.gen(function* () {
          // Claude answered once (a plan that breaks the rules) before.
          const result = yield* planEnds([
            { days: [], notes: "" },
            new ClaudeFailed({ reason }),
          ]);
          assert.strictEqual(result.ended.status, "failed");
          assert.deepStrictEqual(result.ended.failure, {
            reason: "plannerFailed",
            cheapestTotal: null,
          });
          assert.deepStrictEqual(result.balance, kept);
        }),
    );

    it.effect("keeps the credit used when Claude's plans break the rules", () =>
      Effect.gen(function* () {
        // A food that was not offered, three times (the planner's attempts).
        const unknownFood = (request: JsonRequest<unknown>) => {
          const plan = dinners(request);
          return {
            ...plan,
            days: plan.days.map((day) => ({
              ...day,
              meals: day.meals.map((meal) => ({
                ...meal,
                ingredients: [{ ref: "f9999", amount: 300 }],
              })),
            })),
          };
        };
        const result = yield* planEnds([unknownFood, unknownFood, unknownFood]);
        assert.deepStrictEqual(result.ended.failure, {
          reason: "invalidPlan",
          cheapestTotal: null,
        });
        assert.deepStrictEqual(result.balance, kept);
      }),
    );

    it.effect("keeps the credit used when the budget cannot be met", () =>
      Effect.gen(function* () {
        const result = yield* planEnds([dinners, dinners, dinners], {
          ...planRequest,
          budget: 1,
        });
        assert.strictEqual((result.ended.failure as Json).reason, "overBudget");
        assert.deepStrictEqual(result.balance, kept);
      }),
    );

    it.effect("gives the credit back when there are no candidates", () =>
      Effect.gen(function* () {
        const t = yield* setupBuyer(1, { answers: [dinners] });
        const pending = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        const failed = yield* t.settled(t.buyer.cookie, pending.id);
        assert.strictEqual((failed.failure as Json).reason, "noCandidates");
        assert.deepStrictEqual(yield* t.balance(t.buyer.id), given);
        // Claude was not asked.
        assert.lengthOf(t.claude.requests, 0);
      }),
    );
  });

  it.effect("gives the credit back when the owner may not plan any more", () =>
    Effect.gen(function* () {
      const { buyer, balance, expect, settle, sql, claude } = yield* setupBuyer(
        1,
        { answers: [dinners] },
      );
      const pending = yield* expect(
        202,
        buyer.cookie,
        "POST",
        "/food/meal-plans",
        { body: planRequest },
      );
      yield* sql(
        (sql) => sql`
          DELETE FROM user_roles
          WHERE user_id = ${buyer.id} AND role = 'mealPlanBuyer'
        `,
      );
      yield* settle(
        sql(
          (sql) => sql<{ readonly status: string }>`
            SELECT status FROM meal_plans WHERE id = ${String(pending.id)}
          `,
        ),
        ([row]) => row?.status !== "pending",
      );
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 1,
        used: 0,
      });
      assert.lengthOf(claude.requests, 0);
    }),
  );

  it.effect(
    "gives the credit back when a plan is deleted before its job started",
    () =>
      Effect.gen(function* () {
        const { buyer, balance, create, expect } = yield* setupBuyer(1);
        const pending = yield* expect(
          202,
          buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        assert.strictEqual((yield* create(buyer.cookie)).status, 402);
        yield* expect(
          204,
          buyer.cookie,
          "DELETE",
          `/food/meal-plans/${String(pending.id)}`,
        );
        assert.deepStrictEqual(yield* balance(buyer.id), {
          available: 1,
          used: 0,
        });
        assert.strictEqual((yield* create(buyer.cookie)).status, 202);
      }),
  );

  it.effect("keeps the credit used when a written plan is deleted", () =>
    Effect.gen(function* () {
      const { buyer, balance, create, expect, importNz, settled } =
        yield* setupBuyer(1, { answers: [dinners] });
      yield* importNz;
      const pending = yield* expect(
        202,
        buyer.cookie,
        "POST",
        "/food/meal-plans",
        { body: planRequest },
      );
      const ready = yield* settled(buyer.cookie, pending.id);
      assert.strictEqual(ready.status, "ready", JSON.stringify(ready.failure));
      yield* expect(
        204,
        buyer.cookie,
        "DELETE",
        `/food/meal-plans/${String(pending.id)}`,
      );
      assert.deepStrictEqual(yield* balance(buyer.id), {
        available: 0,
        used: 1,
      });
      assert.strictEqual((yield* create(buyer.cookie)).status, 402);
    }),
  );

  it.effect(
    "gives the credit back when a plan is abandoned before its job started",
    () =>
      Effect.gen(function* () {
        const { buyer, balance, expect, sql, services } = yield* setupBuyer(2);
        const abandoned = yield* expect(
          202,
          buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        const recent = yield* expect(
          202,
          buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        // Its job was lost long ago.
        yield* sql(
          (sql) => sql`
          UPDATE meal_plans SET created_at = '2000-01-01T00:00:00Z'
          WHERE id = ${String(abandoned.id)}
        `,
        );
        const failed = yield* Effect.flatMap(
          FoodCommands,
          (commands) => commands.failAbandonedPlans,
        ).pipe(Effect.provide(services));
        assert.strictEqual(failed, 1);
        const rows = yield* sql(
          (sql) => sql<{ readonly id: string; readonly status: string }>`
          SELECT id, status FROM meal_plans WHERE user_id = ${buyer.id}
        `,
        );
        assert.deepStrictEqual(
          Object.fromEntries(rows.map((row) => [row.id, row.status])),
          {
            [String(abandoned.id)]: "failed",
            [String(recent.id)]: "pending",
          },
        );
        assert.deepStrictEqual(yield* balance(buyer.id), {
          available: 1,
          used: 1,
        });
      }),
  );

  describe("a plan whose job started", () => {
    /** A pending plan of the buyer whose job asked Claude already. */
    const startedPlan = (
      t: Effect.Success<ReturnType<typeof setupBuyer>>,
      id: unknown,
    ) =>
      t.sql(
        (sql) => sql`
          UPDATE meal_plans SET started_at = now() WHERE id = ${String(id)}
        `,
      );

    it.effect("keeps the credit used when it is deleted", () =>
      Effect.gen(function* () {
        const t = yield* setupBuyer(1);
        const pending = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        yield* startedPlan(t, pending.id);
        yield* t.expect(
          204,
          t.buyer.cookie,
          "DELETE",
          `/food/meal-plans/${String(pending.id)}`,
        );
        assert.deepStrictEqual(yield* t.balance(t.buyer.id), {
          available: 0,
          used: 1,
        });
      }),
    );

    it.effect("keeps the credit used when it is abandoned", () =>
      Effect.gen(function* () {
        const t = yield* setupBuyer(2);
        const started = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        const unstarted = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        yield* startedPlan(t, started.id);
        yield* t.sql(
          (sql) => sql`
            UPDATE meal_plans SET created_at = '2000-01-01T00:00:00Z'
            WHERE user_id = ${t.buyer.id}
          `,
        );
        const failed = yield* Effect.flatMap(
          FoodCommands,
          (commands) => commands.failAbandonedPlans,
        ).pipe(Effect.provide(t.services));
        assert.strictEqual(failed, 2);
        const rows = yield* t.sql(
          (sql) => sql<{ readonly id: string; readonly status: string }>`
            SELECT id, status FROM meal_plans WHERE user_id = ${t.buyer.id}
          `,
        );
        assert.deepStrictEqual(
          Object.fromEntries(rows.map((row) => [row.id, row.status])),
          {
            [String(started.id)]: "failed",
            [String(unstarted.id)]: "failed",
          },
        );
        // Only the plan whose job never started gave its credit back.
        assert.deepStrictEqual(yield* t.balance(t.buyer.id), {
          available: 1,
          used: 1,
        });
      }),
    );

    it.effect("is marked started by its job", () =>
      Effect.gen(function* () {
        const t = yield* setupBuyer(1, { answers: [dinners] });
        yield* t.importNz;
        const pending = yield* t.expect(
          202,
          t.buyer.cookie,
          "POST",
          "/food/meal-plans",
          { body: planRequest },
        );
        const startedOf = () =>
          t.sql(
            (sql) => sql<{ readonly started: boolean }>`
              SELECT started_at IS NOT NULL AS started FROM meal_plans
              WHERE id = ${String(pending.id)}
            `,
          );
        assert.deepStrictEqual(yield* startedOf(), [{ started: false }]);
        yield* t.settled(t.buyer.cookie, pending.id);
        assert.deepStrictEqual(yield* startedOf(), [{ started: true }]);
      }),
    );
  });

  it.effect("ignores the lookup of a buyer, who searches what is stored", () =>
    Effect.gen(function* () {
      const { buyer, cook, expect } = yield* setupBuyer(1);
      const query = "country=DE&q=haferflocken";
      const asBuyer = yield* expect(
        200,
        buyer.cookie,
        "GET",
        `/food/items?${query}&lookup=true`,
      );
      assert.lengthOf(asBuyer.items as Array<Json>, 0);
      // Nothing was looked up and stored: not even a foodPlanner finds it.
      const asCook = yield* expect(
        200,
        cook.cookie,
        "GET",
        `/food/items?${query}`,
      );
      assert.lengthOf(asCook.items as Array<Json>, 0);
      // A foodPlanner's lookup still works, and the buyer then finds it.
      const looked = yield* expect(
        200,
        cook.cookie,
        "GET",
        `/food/items?${query}&lookup=true`,
      );
      assert.lengthOf(looked.items as Array<Json>, 1);
      const found = yield* expect(
        200,
        buyer.cookie,
        "GET",
        `/food/items?${query}`,
      );
      assert.lengthOf(found.items as Array<Json>, 1);
    }),
  );

  it.effect("lets a buyer read food data and their own plans", () =>
    Effect.gen(function* () {
      const { buyer, other, cook, expect, importNz, plan } =
        yield* setupBuyer(1);
      yield* importNz;
      const found = yield* expect(
        200,
        buyer.cookie,
        "GET",
        "/food/items?country=NZ&q=eggs",
      );
      const [eggs] = found.items as unknown as ReadonlyArray<Json>;
      assert.isDefined(eggs);
      yield* expect(
        200,
        buyer.cookie,
        "GET",
        `/food/items/${String(eggs!.id)}`,
      );
      const created = yield* expect(
        202,
        buyer.cookie,
        "POST",
        "/food/meal-plans",
        { body: planRequest },
      );
      const mine = yield* expect(200, buyer.cookie, "GET", "/food/meal-plans");
      assert.lengthOf(mine as unknown as Array<Json>, 1);
      yield* plan(buyer.cookie, created.id);
      // Not the plans of others.
      yield* expect(404, buyer.cookie, "GET", `/food/meal-plans/${unknownId}`);
      const theirs = yield* expect(200, cook.cookie, "GET", "/food/meal-plans");
      assert.lengthOf(theirs as unknown as Array<Json>, 0);
      yield* expect(
        404,
        other.cookie,
        "GET",
        `/food/meal-plans/${String(created.id)}`,
      );
    }),
  );

  it.effect("keeps imports and data sources for foodPlanners (403)", () =>
    Effect.gen(function* () {
      const { buyer, call } = yield* setupBuyer(1);
      const forbidden = [
        ["GET", "/food/sources"],
        ["GET", "/food/imports"],
        ["GET", `/food/imports/${unknownId}`],
      ] as const;
      for (const [method, path] of forbidden) {
        assert.strictEqual(
          (yield* call(buyer.cookie, method, path)).status,
          403,
          `${method} ${path}`,
        );
      }
      const start = yield* call(buyer.cookie, "POST", "/food/imports", {
        body: { country: "NZ", source: "statsNz" },
      });
      assert.strictEqual(start.status, 403);
    }),
  );

  it.effect("keeps a user without a role out of all of it (403)", () =>
    Effect.gen(function* () {
      const { user, call } = yield* setupBuyer(0);
      for (const [method, path] of [
        ["GET", "/food/items?country=NZ&q=eggs"],
        ["GET", "/food/meal-plans"],
        ["GET", `/food/meal-plans/${unknownId}`],
        ["DELETE", `/food/meal-plans/${unknownId}`],
      ] as const) {
        assert.strictEqual(
          (yield* call(user.cookie, method, path)).status,
          403,
          `${method} ${path}`,
        );
      }
    }),
  );
});
