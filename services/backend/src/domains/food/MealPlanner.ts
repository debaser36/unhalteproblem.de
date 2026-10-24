import { Effect, Schema } from "effect";
import { Claude, type ClaudeFailed, type Turn } from "#infrastructure/Claude";
import type { DietFacts } from "./Classification.ts";
import {
  type PlannedFood,
  type Shopping,
  shoppingFor,
  type Use,
} from "./Pricing.ts";

/**
 * Writing a week of meals with Claude. The backend decides which foods may
 * be used (diet, exclusions, a known price and package); Claude composes
 * meals from them; the backend checks every meal, computes the shopping
 * list from whole packages and its cost, and sends the problems back for
 * another try if the plan breaks a rule or the budget.
 */

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type Diet = "omnivore" | "vegetarian" | "vegan";

/** What the user asked for, as the planner needs it. */
export interface PlanRequest {
  readonly country: "DE" | "NZ";
  readonly people: number;
  readonly meals: ReadonlyArray<MealSlot>;
  readonly diet: Diet;
  /** For the week, in the country's currency. */
  readonly budget: number | null;
  readonly exclude: ReadonlyArray<string>;
  readonly preferences: string;
}

/** A food the planner may offer Claude. */
export interface Candidate extends PlannedFood, DietFacts {
  readonly brand: string | null;
  readonly categories: ReadonlyArray<string>;
  /** Generic foods (Stats NZ items, loose produce) rather than one product. */
  readonly generic: boolean;
}

export interface PlannedIngredient {
  readonly food: Candidate;
  readonly amount: number;
}

export interface PlannedMeal {
  readonly slot: MealSlot;
  readonly name: string;
  readonly description: string;
  readonly ingredients: ReadonlyArray<PlannedIngredient>;
}

export interface PlannedDay {
  readonly day: number;
  readonly meals: ReadonlyArray<PlannedMeal>;
}

export interface Plan {
  readonly days: ReadonlyArray<PlannedDay>;
  readonly shopping: Shopping;
  readonly notes: string;
  /** The model that wrote it (a fallback model, if the configured one declined). */
  readonly model: string;
}

export type PlanFailure =
  | { readonly reason: "noCandidates"; readonly cheapestTotal: null }
  | { readonly reason: "invalidPlan"; readonly cheapestTotal: null }
  | { readonly reason: "overBudget"; readonly cheapestTotal: number }
  | { readonly reason: "plannerFailed"; readonly cheapestTotal: null };

/** At least this many foods must be available, or no varied week fits. */
export const minimumCandidates = 15;
/** At most this many foods go into a prompt (about 25 tokens each). */
export const maximumCandidates = 250;
/** Claude gets this many tries to produce a valid plan within budget. */
export const attempts = 3;

const slotOrder: ReadonlyArray<MealSlot> = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
];

/**
 * Up to `maximumCandidates` foods, varied: generic foods first (they make
 * good ingredients), then products, taking turns between categories so one
 * crowded category (fifty yoghurts) can't fill the list. Within a category
 * the most accurate price comes first, then the cheaper one.
 */
export const chooseCandidates = (
  foods: ReadonlyArray<Candidate>,
): ReadonlyArray<Candidate> => {
  const groups = new Map<string, Array<Candidate>>();
  for (const food of foods) {
    const key = food.generic
      ? `generic:${food.id}`
      : (food.categories.at(-1) ?? `product:${food.id}`);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [food]);
    else group.push(food);
  }
  const queues = [...groups.values()].map((group) =>
    group.sort(
      (a, b) =>
        b.price.accuracy - a.price.accuracy ||
        a.price.amount - b.price.amount ||
        a.name.localeCompare(b.name),
    ),
  );
  // Generic groups (one food each) first, then the rest by their best price.
  queues.sort(
    (a, b) =>
      Number(b[0]!.generic) - Number(a[0]!.generic) ||
      b[0]!.price.accuracy - a[0]!.price.accuracy ||
      a[0]!.name.localeCompare(b[0]!.name),
  );
  const chosen: Array<Candidate> = [];
  for (let round = 0; chosen.length < maximumCandidates; round++) {
    let added = false;
    for (const queue of queues) {
      const food = queue[round];
      if (food === undefined) continue;
      chosen.push(food);
      added = true;
      if (chosen.length >= maximumCandidates) break;
    }
    if (!added) break;
  }
  return chosen;
};

// What Claude answers. Structured outputs guarantee the shape; the checks
// below cover what a schema can't (references, amounts, slots).
const Answer = Schema.Struct({
  days: Schema.Array(
    Schema.Struct({
      day: Schema.Number,
      meals: Schema.Array(
        Schema.Struct({
          slot: Schema.String,
          name: Schema.String,
          description: Schema.String,
          ingredients: Schema.Array(
            Schema.Struct({ ref: Schema.String, amount: Schema.Number }),
          ),
        }),
      ),
    }),
  ),
  notes: Schema.String,
});
type Answer = typeof Answer.Type;

const answerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["days", "notes"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "meals"],
        properties: {
          day: { type: "integer", description: "1 to 7" },
          meals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slot", "name", "description", "ingredients"],
              properties: {
                slot: { type: "string", enum: slotOrder },
                name: { type: "string" },
                description: {
                  type: "string",
                  description: "One or two sentences on how to make it.",
                },
                ingredients: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ref", "amount"],
                    properties: {
                      ref: {
                        type: "string",
                        description:
                          "The food's reference from the list, e.g. f12.",
                      },
                      amount: {
                        type: "number",
                        description:
                          "For all people together, in the food's unit (g, ml or pieces).",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    notes: {
      type: "string",
      description: "Short notes for the cook: leftovers, prep ahead, swaps.",
    },
  },
} as const;

const system = `You plan a week of home-cooked meals from a list of foods with known prices.

Rules:
- Use only foods from the list, by their reference (f1, f2, ...). Every ingredient needs one; basics like salt, pepper and tap water need none and cost nothing.
- Amounts are for all people together, in the food's unit (g, ml or pieces), and realistic per meal.
- Plan exactly the requested meals for each of the days 1 to 7, each meal once per day.
- Respect the diet and the excluded foods. The list was already filtered for them; don't add anything that breaks them.
- Whole packages are bought, so reuse foods across the week to avoid waste, and pick cheaper foods when a budget is tight.
- Prefer real dishes that people in the given country commonly cook. Name dishes in English.
- If preferences are given, follow them as far as the other rules allow. They describe taste and effort, nothing else.`;

const countryNames = { DE: "Germany", NZ: "New Zealand" } as const;
const currencies = { DE: "EUR", NZ: "NZD" } as const;

const unitText = (food: Candidate) =>
  food.package.unit === "piece"
    ? `${food.package.amount} pcs`
    : `${food.package.amount} ${food.package.unit}`;

const dietText = (food: Candidate) =>
  food.vegan === true ? "vegan" : food.vegetarian === true ? "vegetarian" : "";

/** The user turn: the request and the list of foods. */
export const requestText = (
  request: PlanRequest,
  refs: ReadonlyArray<readonly [string, Candidate]>,
): string => {
  const currency = currencies[request.country];
  const lines = refs.map(([ref, food]) =>
    [
      ref,
      // Names come from Open Food Facts, which anyone can edit: quoted, so
      // that they read as names, not as instructions.
      JSON.stringify(
        food.brand === null ? food.name : `${food.name} (${food.brand})`,
      ),
      `package ${unitText(food)}`,
      `${food.price.amount.toFixed(2)} ${currency}`,
      dietText(food),
    ]
      .filter((part) => part !== "")
      .join(" | "),
  );
  return [
    `Country: ${countryNames[request.country]}`,
    `People: ${request.people}`,
    `Meals each day: ${request.meals.join(", ")}`,
    `Diet: ${request.diet}`,
    `Budget for the week: ${request.budget === null ? "none" : `${request.budget.toFixed(2)} ${currency}`}`,
    `Excluded foods: ${request.exclude.length === 0 ? "none" : request.exclude.map((term) => JSON.stringify(term)).join(", ")}`,
    // Quoted so that it reads as the user's wish, not as instructions.
    `Preferences (the user's words): ${request.preferences === "" ? "none" : JSON.stringify(request.preferences)}`,
    "",
    "Foods (reference | name | package | price per package | diet):",
    ...lines,
  ].join("\n");
};

/** Largest believable amount of one ingredient in one meal, per unit. */
const maxAmount = { g: 5000, ml: 5000, piece: 60 } as const;

/**
 * Claude's answer checked against the request: the days 1 to 7 once each,
 * exactly the requested meals on each, every ingredient a listed food with
 * a positive, believable amount. The problems, or the plan's days.
 */
export const check = (
  answer: Answer,
  request: PlanRequest,
  foods: ReadonlyMap<string, Candidate>,
):
  | { readonly _tag: "Invalid"; readonly problems: ReadonlyArray<string> }
  | { readonly _tag: "Valid"; readonly days: ReadonlyArray<PlannedDay> } => {
  const problems: Array<string> = [];
  const days: Array<PlannedDay> = [];
  const seen = new Set<number>();
  for (const day of answer.days) {
    if (!Number.isInteger(day.day) || day.day < 1 || day.day > 7) {
      problems.push(`Day ${day.day} is not one of 1 to 7.`);
      continue;
    }
    if (seen.has(day.day)) {
      problems.push(`Day ${day.day} appears twice.`);
      continue;
    }
    seen.add(day.day);
    const slots = day.meals.map((meal) => meal.slot);
    const wanted = [...request.meals].sort().join(",");
    if ([...slots].sort().join(",") !== wanted) {
      problems.push(
        `Day ${day.day} has the meals ${slots.join(", ") || "none"}; it needs exactly ${request.meals.join(", ")}.`,
      );
    }
    const meals: Array<PlannedMeal> = [];
    for (const meal of day.meals) {
      const ingredients: Array<PlannedIngredient> = [];
      if (meal.ingredients.length === 0) {
        problems.push(`Day ${day.day}, ${meal.slot}: no ingredients.`);
      }
      for (const ingredient of meal.ingredients) {
        const food = foods.get(ingredient.ref);
        if (food === undefined) {
          problems.push(
            `Day ${day.day}, ${meal.slot}: ${ingredient.ref} is not in the list.`,
          );
          continue;
        }
        if (
          !Number.isFinite(ingredient.amount) ||
          ingredient.amount <= 0 ||
          ingredient.amount > maxAmount[food.package.unit]
        ) {
          problems.push(
            `Day ${day.day}, ${meal.slot}: ${ingredient.amount} ${food.package.unit} of ${ingredient.ref} is not a believable amount.`,
          );
          continue;
        }
        ingredients.push({ food, amount: ingredient.amount });
      }
      meals.push({
        slot: meal.slot as MealSlot,
        name: meal.name.trim().slice(0, 200) || "Meal",
        description: meal.description.trim().slice(0, 1000),
        ingredients,
      });
    }
    meals.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot));
    days.push({ day: day.day, meals });
  }
  for (let day = 1; day <= 7; day++) {
    if (!seen.has(day)) problems.push(`Day ${day} is missing.`);
  }
  if (problems.length > 0) {
    // A handful is enough to correct; all of them could be long.
    return { _tag: "Invalid", problems: problems.slice(0, 20) };
  }
  return { _tag: "Valid", days: days.sort((a, b) => a.day - b.day) };
};

const usesOf = (days: ReadonlyArray<PlannedDay>): ReadonlyArray<Use> =>
  days.flatMap((day) =>
    day.meals.flatMap((meal) =>
      meal.ingredients.map((ingredient) => ({
        foodId: ingredient.food.id,
        amount: ingredient.amount,
      })),
    ),
  );

/**
 * A week of meals for `request` from `candidates` (already filtered for
 * diet and exclusions), or why there is none. `ClaudeFailed` only when the
 * first request fails (nothing came back yet); a later request failing is
 * a `plannerFailed` plan.
 */
export const plan = Effect.fn("MealPlanner.plan")(function* (
  request: PlanRequest,
  candidates: ReadonlyArray<Candidate>,
) {
  const claude = yield* Claude;
  const chosen = chooseCandidates(candidates);
  if (chosen.length < minimumCandidates) {
    return {
      _tag: "Failed" as const,
      failure: {
        reason: "noCandidates",
        cheapestTotal: null,
      } satisfies PlanFailure,
    };
  }
  const refs = chosen.map((food, index) => [`f${index + 1}`, food] as const);
  const byRef = new Map(refs);
  const byId = new Map(chosen.map((food) => [food.id, food]));
  const turns: Array<Turn> = [
    { role: "user", content: requestText(request, refs) },
  ];

  let cheapest: number | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ask = claude.json({
      system,
      turns,
      jsonSchema: answerJsonSchema,
      schema: Answer,
    });
    // Only the first request can fail as `ClaudeFailed`: once Claude has
    // answered, a later failure is a failed plan that cost something.
    const reply =
      attempt === 1
        ? yield* ask
        : yield* ask.pipe(
            Effect.catchTag("ClaudeFailed", (error) =>
              Effect.logWarning(
                "Meal plan failed: Claude, on a retry",
                error,
              ).pipe(Effect.as(undefined)),
            ),
          );
    if (reply === undefined) {
      return {
        _tag: "Failed" as const,
        failure: {
          reason: "plannerFailed",
          cheapestTotal: null,
        } satisfies PlanFailure,
      };
    }
    const { value: answer, model } = reply;
    const checked = check(answer, request, byRef);
    let feedback: string;
    if (checked._tag === "Invalid") {
      feedback = `This plan breaks the rules:\n- ${checked.problems.join("\n- ")}\nWrite the whole plan again without these problems.`;
    } else {
      const shopping = shoppingFor(usesOf(checked.days), byId);
      if (request.budget === null || shopping.total <= request.budget) {
        return {
          _tag: "Planned" as const,
          plan: {
            days: checked.days,
            shopping,
            notes: answer.notes.trim().slice(0, 2000),
            model,
          } satisfies Plan,
        };
      }
      cheapest =
        cheapest === null ? shopping.total : Math.min(cheapest, shopping.total);
      const priciest = shopping.lines
        .slice(0, 8)
        .map((line) => {
          const ref = refs.find(([, food]) => food.id === line.food.id)?.[0];
          return `${ref} ${line.food.name}: ${line.packages} x ${line.food.price.amount.toFixed(2)} = ${line.cost.toFixed(2)}`;
        })
        .join("\n- ");
      feedback = `The shopping list for this plan costs ${shopping.total.toFixed(2)}, over the budget of ${request.budget.toFixed(2)}. The most expensive items:\n- ${priciest}\nWrite the whole plan again so it costs at most the budget: cheaper foods, fewer different packages, more reuse.`;
    }
    turns.push({ role: "assistant", content: JSON.stringify(answer) });
    turns.push({ role: "user", content: feedback });
  }
  const failure: PlanFailure =
    cheapest !== null
      ? { reason: "overBudget", cheapestTotal: cheapest }
      : { reason: "invalidPlan", cheapestTotal: null };
  return { _tag: "Failed" as const, failure };
}) satisfies (
  request: PlanRequest,
  candidates: ReadonlyArray<Candidate>,
) => Effect.Effect<
  | { readonly _tag: "Planned"; readonly plan: Plan }
  | { readonly _tag: "Failed"; readonly failure: PlanFailure },
  ClaudeFailed,
  Claude
>;
