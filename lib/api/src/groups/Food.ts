import { Authentication } from "#Authentication";
import { RequireRoles } from "#Authorization";
import {
  FoodDataSource,
  FoodImport,
  FoodImportId,
  FoodItemDetails,
  FoodItemId,
  FoodItemPage,
  FoodItemQuery,
  MealPlan,
  MealPlanId,
  MealPlanRequest,
  MealPlanSummary,
  StartFoodImportPayload,
} from "#domain/Food";
import { FoodImportAlreadyRunning } from "#errors/FoodImportAlreadyRunning";
import { FoodImportNotFound } from "#errors/FoodImportNotFound";
import { FoodImportNotSupported } from "#errors/FoodImportNotSupported";
import { FoodItemNotFound } from "#errors/FoodItemNotFound";
import { MealPlanNotFound } from "#errors/MealPlanNotFound";
import { MealPlannerUnavailable } from "#errors/MealPlannerUnavailable";
import { NoCreditsLeft } from "#errors/NoCreditsLeft";
import { RateLimited } from "#errors/RateLimited";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Requires `foodPlanner`: the unlimited use of the food planner. On the
 * group's food imports and data sources (the endpoints beyond what a
 * `mealPlanBuyer` may do).
 */
export const RequireFoodPlanner = RequireRoles("foodPlanner");

/**
 * Requires `foodPlanner` or `mealPlanBuyer` (any of them): searching and
 * reading food items and the caller's own meal plans. On the whole group.
 * Making a meal plan costs a `mealPlanBuyer` without `foodPlanner` one
 * credit.
 */
export const RequireMealPlanning = RequireRoles("foodPlanner", "mealPlanBuyer");

/** Path parameters of the endpoints for one food item. */
const ItemParams = { itemId: FoodItemId };

/** Path parameters of the endpoints for one import. */
const ImportParams = { importId: FoodImportId };

/** Path parameters of the endpoints for one meal plan. */
const PlanParams = { planId: MealPlanId };

/**
 * Success of `startFoodImport`: the new `FoodImport`, queued, with status
 * 202 (it runs in the background). A one-member union, so the OpenAPI
 * document keeps one `FoodImport` component (see `CreatedProject` in the
 * project admin group).
 */
const AcceptedFoodImport = Schema.Union([FoodImport])
  .pipe(HttpApiSchema.status(202))
  .annotate({ description: "The new import, queued." });

/**
 * Success of `createMealPlan`: the new, pending `MealPlan`, with status 202
 * (an AI writes it in the background). A one-member union for the same
 * reason as `AcceptedFoodImport`.
 */
const AcceptedMealPlan = Schema.Union([MealPlan])
  .pipe(HttpApiSchema.status(202))
  .annotate({ description: "The new meal plan, pending." });

// Shared by the endpoint descriptions: the food planner only, and the whole
// group.
const plannerRule =
  "Requires `foodPlanner` (not `mealPlanBuyer`). Answers with " +
  "`Cache-Control: no-store`.";
const mealPlanningRule =
  "Requires `foodPlanner` or `mealPlanBuyer`. Answers with " +
  "`Cache-Control: no-store`.";

/**
 * The food planner, for users with the `foodPlanner` role, or the
 * `mealPlanBuyer` role of a bought meal-plan credit: food items with prices
 * from Open Food Facts, Open Prices and Stats NZ, imports of that data, and
 * weekly meal plans that an AI writes from the priced foods. Every endpoint
 * requires a session (`Authentication`, 401) and `foodPlanner` or
 * `mealPlanBuyer` (`RequireMealPlanning`, 403 `Forbidden`), both on the
 * group, so an endpoint added here is protected without further ado. The
 * food data sources and the imports (`listFoodSources`, `listFoodImports`,
 * `startFoodImport`, `getFoodImport`) additionally require `foodPlanner`
 * itself (`RequireFoodPlanner`, 403 `Forbidden`), on the endpoint. The state-changing endpoints
 * also require `SameOrigin` (403 `Forbidden`). The backend answers every
 * endpoint with `Cache-Control: no-store`.
 *
 * Credits: a user with `foodPlanner` uses the planner without limit. A
 * `mealPlanBuyer` without it pays one meal-plan credit (see
 * `CreditFeature`) per `createMealPlan`; without a credit left the request
 * fails with 402 `NoCreditsLeft`. A failed plan gives its credit back only
 * when it cost nothing: `noCandidates`, the owner lost access before the
 * job ran, the plan was abandoned before its job started, or Claude could
 * not be reached (`plannerFailed` because the first request to Claude
 * failed before Claude worked: no connection, a 429 or a 5xx status).
 * `overBudget`, `invalidPlan` and other `plannerFailed` cases (a refusal,
 * a cut-off answer, a request error, a timeout, an error mid-answer, or any
 * failure after Claude answered once, such as in a retry) keep the credit
 * used. Deleting a plan
 * gives its credit back only if the plan is still pending and its job has
 * not started yet.
 *
 * `searchFoodItems` with `lookup` is for `foodPlanner` only: a
 * `mealPlanBuyer` without it searches the stored data, `lookup` is
 * ignored and not refused.
 *
 * Prices are always for one package of the item. Meal plans and imports are
 * written in the background: the endpoints that start them answer 202 with
 * the new `MealPlan` or `FoodImport`, and the client polls the `get…`
 * endpoint until it is no longer pending. Meal plans belong to their
 * creator: other users' plans count as missing.
 *
 * Middleware order: the middleware added later is the outer one and runs
 * first, and `HttpApi` decodes the payload inside all of them. Group
 * middlewares are added after the endpoints, so they run first:
 * `Authentication` (401), then `RequireMealPlanning` (403). On the
 * endpoints, `RequireFoodPlanner` is added after `SameOrigin`, so it runs
 * before it: Authentication (401) → RequireMealPlanning (403) →
 * RequireFoodPlanner (403) → SameOrigin (403) → payload → handler. A
 * `mealPlanBuyer` therefore gets 403 for an import without the server
 * reading its body.
 */
export class FoodPlannerGroup extends HttpApiGroup.make("foodPlanner")
  .add(
    HttpApiEndpoint.get("listFoodSources", "/food/sources", {
      success: Schema.Array(FoodDataSource).annotate({
        description:
          "The sources of the food data with their licences and countries.",
      }),
      error: [],
    })
      .middleware(RequireFoodPlanner)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List the sources of the food data",
          description:
            plannerRule +
            " Returns the sources of the food data with their licences, to " +
            "credit in the interface (the Open Database License of Open Food " +
            "Facts and Open Prices requires it).",
        }),
      ),
    HttpApiEndpoint.get("searchFoodItems", "/food/items", {
      query: FoodItemQuery,
      success: FoodItemPage,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Search the food items",
        description:
          mealPlanningRule +
          " Searches the food items of one `country`, optionally by name " +
          "(`q`), `diet` and whether they have a price (`priced`). With " +
          "`lookup`, the term is also looked up on Open Food Facts and " +
          "what it finds is cached, so this can take a moment; that is " +
          "for `foodPlanner` only. For a `mealPlanBuyer` without " +
          "`foodPlanner`, `lookup` is ignored (not refused) and the " +
          "search covers the stored data. Pages with `limit` (50 if " +
          "absent) and `offset`.",
      }),
    ),
    HttpApiEndpoint.get("getFoodItem", "/food/items/:itemId", {
      params: ItemParams,
      success: FoodItemDetails,
      error: FoodItemNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a food item",
        description:
          mealPlanningRule +
          " Returns the item with its ingredient tags and up to 20 prices, " +
          "newest first. Answers 404 `FoodItemNotFound` for an unknown id.",
      }),
    ),
    HttpApiEndpoint.get("listFoodImports", "/food/imports", {
      success: Schema.Array(FoodImport).annotate({
        description: "The latest imports, newest first, at most 50.",
      }),
      error: [],
    })
      .middleware(RequireFoodPlanner)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List the food data imports",
          description:
            plannerRule +
            " Returns the latest imports, whatever their status, newest " +
            "first, at most 50.",
        }),
      ),
    HttpApiEndpoint.post("startFoodImport", "/food/imports", {
      payload: StartFoodImportPayload,
      success: AcceptedFoodImport,
      error: [FoodImportNotSupported, FoodImportAlreadyRunning],
    })
      .middleware(SameOrigin)
      // Added after `SameOrigin`, so it runs before it (see the group).
      .middleware(RequireFoodPlanner)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Start a food data import",
          description:
            plannerRule +
            " Requires a same-origin request. Queues the import of the " +
            "`source` for the `country` and answers 202 with it; it runs " +
            "in the background, so poll `getFoodImport` for its status. " +
            "Answers 422 `FoodImportNotSupported` if the source has no " +
            "data for the country (Stats NZ is NZ only) and 409 " +
            "`FoodImportAlreadyRunning` if an import of the same country " +
            "and source is queued or running.",
        }),
      ),
    HttpApiEndpoint.get("getFoodImport", "/food/imports/:importId", {
      params: ImportParams,
      success: FoodImport,
      error: FoodImportNotFound,
    })
      .middleware(RequireFoodPlanner)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Get a food data import",
          description:
            plannerRule +
            " Returns the import with its status and counters. Answers 404 " +
            "`FoodImportNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.post("createMealPlan", "/food/meal-plans", {
      payload: MealPlanRequest,
      success: AcceptedMealPlan,
      error: [MealPlannerUnavailable, RateLimited, NoCreditsLeft],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Create a meal plan",
          description:
            mealPlanningRule +
            " Requires a same-origin request. Starts a meal plan for 7 " +
            "days and answers 202 with the pending plan. An AI writes the " +
            "plan in the background, which can take a few minutes, so " +
            "poll `getMealPlan` until its status is no longer `pending`: " +
            "`ready`, or `failed` with the `failure` reason (too few " +
            "priced foods, a budget that is too low, invalid plans or a " +
            "failing planner). Only foods with a price are used. A caller " +
            "with `foodPlanner` plans without limit; without it, a request " +
            "consumes one meal-plan credit. A failed plan gives it back only " +
            "when it cost nothing: `noCandidates`, the owner lost access " +
            "before the job ran, the plan was abandoned before its job " +
            "started, or Claude could not be reached (`plannerFailed` " +
            "because the first request to Claude failed before Claude " +
            "worked: no connection, a 429 or a 5xx status). `overBudget`, " +
            "`invalidPlan` and other `plannerFailed` cases (a refusal, a " +
            "cut-off answer, a request error, a timeout, an error " +
            "mid-answer, or any failure after Claude answered once, such " +
            "as in a retry) keep the credit used. Answers 503 `MealPlannerUnavailable` if the AI " +
            "planner is not configured or not reachable, 429 " +
            "`RateLimited` if the caller creates plans too often and 402 " +
            "`NoCreditsLeft` (feature `mealPlan`) if the caller is a " +
            "`mealPlanBuyer` without `foodPlanner` and has no available " +
            "meal-plan credit.",
        }),
      ),
    HttpApiEndpoint.get("listMealPlans", "/food/meal-plans", {
      success: Schema.Array(MealPlanSummary).annotate({
        description: "The caller's meal plans, newest first.",
      }),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the caller's meal plans",
        description:
          mealPlanningRule +
          " Returns the caller's own meal plans, whatever their status, " +
          "newest first, without days and shopping list.",
      }),
    ),
    HttpApiEndpoint.get("getMealPlan", "/food/meal-plans/:planId", {
      params: PlanParams,
      success: MealPlan,
      error: MealPlanNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a meal plan",
        description:
          mealPlanningRule +
          " Returns the caller's meal plan with its status. While it is " +
          "`pending`, the days and the shopping list are empty. Answers " +
          "404 `MealPlanNotFound` for an unknown id and for the plan of " +
          "another user.",
      }),
    ),
    HttpApiEndpoint.delete("deleteMealPlan", "/food/meal-plans/:planId", {
      params: PlanParams,
      success: HttpApiSchema.NoContent.annotate({
        description: "The meal plan is deleted.",
      }),
      error: MealPlanNotFound,
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Delete a meal plan",
          description:
            mealPlanningRule +
            " Requires a same-origin request. Deletes the caller's meal " +
            "plan irreversibly. A `mealPlanBuyer` without `foodPlanner` " +
            "gets the plan's credit back only if the plan is still " +
            "`pending` and its job has not started yet. Answers 404 `MealPlanNotFound` for an " +
            "unknown id and for the plan of another user.",
        }),
      ),
  )
  // Both protect every endpoint above. Added after them, so they run before
  // the endpoints' own middlewares; `Authentication` last, so it runs first
  // and answers 401 before `RequireMealPlanning` answers 403.
  .middleware(RequireMealPlanning)
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Food planner",
      description:
        "Food data, imports of it and AI-written weekly meal plans, for " +
        "users with the food planner role, and for buyers of meal-plan " +
        "credits (food items and their own meal plans only).",
    }),
  ) {}
