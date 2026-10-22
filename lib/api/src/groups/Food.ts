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
import { RateLimited } from "#errors/RateLimited";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** Requires `foodPlanner`: the food data, the imports and the meal plans. */
export const RequireFoodPlanner = RequireRoles("foodPlanner");

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

// Shared by every endpoint description.
const plannerRule =
  "Requires `foodPlanner`. Answers with `Cache-Control: no-store`.";

/**
 * The food planner, for users with the `foodPlanner` role: food items with
 * prices from Open Food Facts, Open Prices and Stats NZ, imports of that
 * data, and weekly meal plans that an AI writes from the priced foods. Every
 * endpoint requires a session (`Authentication`, 401) and `foodPlanner`
 * (`RequireFoodPlanner`, 403 `Forbidden`), both on the group, so an endpoint
 * added here is protected without further ado. The state-changing endpoints
 * also require `SameOrigin` (403 `Forbidden`). The backend answers every
 * endpoint with `Cache-Control: no-store`.
 *
 * Prices are always for one package of the item. Meal plans and imports are
 * written in the background: the endpoints that start them answer 202 with
 * the new `MealPlan` or `FoodImport`, and the client polls the `get…`
 * endpoint until it is no longer pending. Meal plans belong to their
 * creator: other users' plans count as missing.
 *
 * Middleware order: group middlewares are added after the endpoints, so
 * they run first: `Authentication` (401), then `RequireFoodPlanner` (403),
 * then the endpoint's `SameOrigin` (403).
 */
export class FoodPlannerGroup extends HttpApiGroup.make("foodPlanner")
  .add(
    HttpApiEndpoint.get("listFoodSources", "/food/sources", {
      success: Schema.Array(FoodDataSource).annotate({
        description:
          "The sources of the food data with their licences and countries.",
      }),
      error: [],
    }).annotateMerge(
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
          plannerRule +
          " Searches the food items of one `country`, optionally by name " +
          "(`q`), `diet` and whether they have a price (`priced`). With " +
          "`lookup`, the term is also looked up on Open Food Facts and " +
          "what it finds is cached, so this can take a moment. Pages " +
          "with `limit` (50 if absent) and `offset`.",
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
          plannerRule +
          " Returns the item with its ingredient tags and up to 20 prices, " +
          "newest first. Answers 404 `FoodItemNotFound` for an unknown id.",
      }),
    ),
    HttpApiEndpoint.get("listFoodImports", "/food/imports", {
      success: Schema.Array(FoodImport).annotate({
        description: "The latest imports, newest first, at most 50.",
      }),
      error: [],
    }).annotateMerge(
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
    }).annotateMerge(
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
      error: [MealPlannerUnavailable, RateLimited],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Create a meal plan",
          description:
            plannerRule +
            " Requires a same-origin request. Starts a meal plan for 7 " +
            "days and answers 202 with the pending plan. An AI writes the " +
            "plan in the background, which can take a few minutes, so " +
            "poll `getMealPlan` until its status is no longer `pending`: " +
            "`ready`, or `failed` with the `failure` reason (too few " +
            "priced foods, a budget that is too low, invalid plans or a " +
            "failing planner). Only foods with a price are used. Answers " +
            "503 `MealPlannerUnavailable` if the AI planner is not " +
            "configured or not reachable and 429 `RateLimited` if the " +
            "caller creates plans too often.",
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
          plannerRule +
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
          plannerRule +
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
            plannerRule +
            " Requires a same-origin request. Deletes the caller's meal " +
            "plan irreversibly. Answers 404 `MealPlanNotFound` for an " +
            "unknown id and for the plan of another user.",
        }),
      ),
  )
  // Both protect every endpoint above. Added after them, so they run before
  // the endpoints' own middlewares; `Authentication` last, so it runs first
  // and answers 401 before `RequireFoodPlanner` answers 403.
  .middleware(RequireFoodPlanner)
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Food planner",
      description:
        "Food data, imports of it and AI-written weekly meal plans, for " +
        "users with the food planner role.",
    }),
  ) {}
