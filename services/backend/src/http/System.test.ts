import { assert, describe, it } from "@effect/vitest";
import { Api } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { SystemHandlers } from "./System.ts";

const makeClient = HttpApiTest.groups(Api, ["system"]);

describe("system", () => {
  it.effect("health returns ok", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.health(), { status: "ok" });
    }).pipe(
      Effect.provide(Layer.merge(SystemHandlers, HttpServer.layerServices)),
    ),
  );
});
