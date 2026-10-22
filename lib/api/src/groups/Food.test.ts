// The food planner group: its OpenAPI document and its middlewares.
import { assert, describe, it } from "@effect/vitest";
import { HttpApi, OpenApi } from "effect/http-api";
import { Api } from "#Api";
import { Authentication } from "#Authentication";
import { SameOrigin } from "#SameOrigin";
import { RequireFoodPlanner } from "./Food.ts";

describe("food planner endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "delete";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();
  const items = "/food/items";
  const imports = "/food/imports";
  const plans = "/food/meal-plans";
  const plan = "/food/meal-plans/{planId}";

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/food/sources", "get"), [
      "200",
      "401",
      "403",
    ]);
    assert.deepStrictEqual(statuses(items, "get"), ["200", "401", "403"]);
    assert.deepStrictEqual(statuses("/food/items/{itemId}", "get"), [
      "200",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(statuses(imports, "get"), ["200", "401", "403"]);
    assert.deepStrictEqual(statuses(imports, "post"), [
      "202",
      "401",
      "403",
      "409",
      "422",
    ]);
    assert.deepStrictEqual(statuses("/food/imports/{importId}", "get"), [
      "200",
      "401",
      "403",
      "404",
    ]);
    assert.deepStrictEqual(statuses(plans, "post"), [
      "202",
      "401",
      "403",
      "429",
      "503",
    ]);
    assert.deepStrictEqual(statuses(plans, "get"), ["200", "401", "403"]);
    assert.deepStrictEqual(statuses(plan, "get"), ["200", "401", "403", "404"]);
    assert.deepStrictEqual(statuses(plan, "delete"), [
      "204",
      "401",
      "403",
      "404",
    ]);
  });

  it("puts every endpoint behind the session", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!path.startsWith("/food/")) continue;
      for (const op of Object.values(item ?? {})) {
        assert.deepStrictEqual(
          (op as { security?: unknown }).security,
          [{ session: [] }],
          path,
        );
      }
    }
  });

  it("documents the search parameters, only the country being required", () => {
    const query = (operation(items, "get")?.parameters ?? [])
      .filter((parameter) => parameter.in === "query")
      .map(({ name, required }) => ({ name, required }));
    assert.deepStrictEqual(query, [
      { name: "country", required: true },
      { name: "q", required: false },
      { name: "diet", required: false },
      { name: "priced", required: false },
      { name: "lookup", required: false },
      { name: "limit", required: false },
      { name: "offset", required: false },
    ]);
  });

  it("answers 202 with one FoodImport and one MealPlan component", () => {
    const json = (path: string, method: Method, status: number) =>
      operation(path, method)?.responses[status]?.content?.["application/json"]
        ?.schema;
    assert.deepStrictEqual(json(imports, "post", 202), {
      anyOf: [{ $ref: "#/components/schemas/FoodImport" }],
      description: "The new import, queued.",
    });
    assert.deepStrictEqual(json(plans, "post", 202), {
      anyOf: [{ $ref: "#/components/schemas/MealPlan" }],
      description: "The new meal plan, pending.",
    });
    assert.isFalse(
      Object.keys(spec.components.schemas).some((name) => /_\d+$/.test(name)),
    );
  });
});

describe("food planner endpoint middleware", () => {
  const middlewares = new Map<string, Array<string>>();
  const methods = new Map<string, string>();
  HttpApi.reflect(Api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware }) => {
      if (group.identifier !== "foodPlanner") return;
      const name = `${group.identifier}.${endpoint.identifier}`;
      middlewares.set(name, [...middleware].map((m) => m.key).sort());
      methods.set(name, endpoint.method);
    },
  });

  it("requires the foodPlanner role", () => {
    assert.strictEqual(
      RequireFoodPlanner.key,
      "@unhalteproblem.de/api/RequireRoles(foodPlanner)",
    );
    assert.deepStrictEqual(RequireFoodPlanner.roles, ["foodPlanner"]);
  });

  it("protects every endpoint and adds SameOrigin to the state-changing ones", () => {
    assert.strictEqual(middlewares.size, 10);
    for (const [name, keys] of middlewares) {
      const expected = [Authentication.key, RequireFoodPlanner.key];
      if (methods.get(name) !== "GET") expected.push(SameOrigin.key);
      assert.deepStrictEqual(keys, expected.sort(), name);
    }
  });
});
