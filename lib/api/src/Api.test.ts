import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiTest, OpenApi } from "effect/http-api";
import { Api } from "./Api.ts";
import { RateLimited } from "./index.ts";

describe("OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);

  it("exposes exactly the contract's paths and operations", () => {
    assert.deepStrictEqual(Object.keys(spec.paths).sort(), [
      "/contact",
      "/health",
    ]);
    assert.deepStrictEqual(Object.keys(spec.paths["/health"] ?? {}), ["get"]);
    assert.deepStrictEqual(Object.keys(spec.paths["/contact"] ?? {}), ["post"]);
    // Operation ids follow the generated client's method names.
    assert.strictEqual(spec.paths["/health"]?.get?.operationId, "health");
    assert.strictEqual(
      spec.paths["/contact"]?.post?.operationId,
      "contact.submit",
    );
  });

  it("documents the response statuses", () => {
    assert.deepStrictEqual(
      Object.keys(spec.paths["/health"]?.get?.responses ?? {}),
      ["200"],
    );
    assert.deepStrictEqual(
      Object.keys(spec.paths["/contact"]?.post?.responses ?? {}).sort(),
      ["202", "429"],
    );
  });

  it("requires no security on the public endpoints", () => {
    assert.deepStrictEqual(spec.paths["/health"]?.get?.security, []);
    assert.deepStrictEqual(spec.paths["/contact"]?.post?.security, []);
  });
});

// Stub handlers, only to exercise the contract's encoding and decoding
// through the in-memory client. Real handlers live in the services.
const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
);
const ContactHandlers = HttpApiBuilder.group(Api, "contact", (handlers) =>
  handlers.handle("submit", ({ payload }) =>
    payload.name === "Spammer" ? Effect.fail(new RateLimited()) : Effect.void,
  ),
);

const makeClient = HttpApiTest.groups(Api, ["system", "contact"]);

layer(
  Layer.mergeAll(SystemHandlers, ContactHandlers, HttpServer.layerServices),
)("client round trip", (it) => {
  const message = { name: "Ada", email: "ada@example.org", message: "Hello!" };

  it.effect("health returns ok", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.health(), { status: "ok" });
    }),
  );

  it.effect("contact.submit answers 202 without a body", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.contact.submit({
        payload: message,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 202);
      assert.strictEqual(yield* response.text, "");
      assert.isUndefined(yield* client.contact.submit({ payload: message }));
    }),
  );

  it.effect("contact.submit surfaces RateLimited as a typed 429 error", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const payload = { ...message, name: "Spammer" };
      const response = yield* client.contact.submit({
        payload,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 429);
      const error = yield* client.contact.submit({ payload }).pipe(Effect.flip);
      assert.instanceOf(error, RateLimited);
    }),
  );

  // The stub handler would accept anything, so a failure here means the
  // payload schema was enforced (client-side encoding or server decoding).
  it.effect("an invalid payload is rejected", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const exit = yield* client.contact
        .submit({ payload: { ...message, email: "not-an-email" } })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});
