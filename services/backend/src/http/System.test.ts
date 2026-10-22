import { assert, describe, it } from "@effect/vitest";
import { Api, ServiceUnavailable } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { NotReady, Readiness } from "#infrastructure/Readiness";
import { MiddlewaresRejectAll } from "#testing/Authentication";
import { DatabaseTest } from "#testing/Database";
import { SystemHandlers } from "./System.ts";

const makeClient = HttpApiTest.groups(Api, ["system"]);

const withReadiness = (readiness: Layer.Layer<Readiness, never, never>) =>
  Effect.provide(
    Layer.mergeAll(
      SystemHandlers,
      HttpServer.layerServices,
      MiddlewaresRejectAll,
    ).pipe(Layer.provide(readiness)),
  );

const notReady = Layer.succeed(Readiness)({
  check: Effect.fail(new NotReady({ dependency: "database" })),
});

describe("system", () => {
  it.effect("health returns ok", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.health(), { status: "ok" });
    }).pipe(withReadiness(notReady)),
  );

  it.effect("ready returns ready while the database answers", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.ready(), { status: "ready" });
    }).pipe(
      withReadiness(
        Readiness.layer.pipe(Layer.provide(Layer.orDie(DatabaseTest))),
      ),
    ),
  );

  it.effect("ready answers 503 when a dependency is down", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.ready().pipe(Effect.flip);
      assert.instanceOf(error, ServiceUnavailable);
    }).pipe(withReadiness(notReady)),
  );
});
