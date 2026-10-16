import { assert, describe, it } from "@effect/vitest";
import { Api, type ContactMessage, RateLimited } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { ContactDelivery } from "#services/ContactDelivery";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { ContactHandlers } from "./Contact.ts";

const makeClient = HttpApiTest.groups(Api, ["contact"]);

const message: ContactMessage = {
  name: "Ada",
  email: "ada@example.org",
  message: "Hello!",
};

/**
 * The contact handlers with a recording delivery and a fresh in-memory rate
 * limiter. The test client sends no `X-Real-IP`, so all calls share one key.
 */
const setup = (limit: number) => {
  const delivered: Array<ContactMessage> = [];
  const layer = ContactHandlers.pipe(
    Layer.provide([
      Layer.succeed(
        ContactDelivery,
        ContactDelivery.of({
          deliver: (message) =>
            Effect.sync(() => {
              delivered.push(message);
            }),
        }),
      ),
      ContactRateLimit.layerWith({ limit, globalLimit: 100, window: "1 hour" }),
    ]),
    Layer.merge(HttpServer.layerServices),
  );
  return { delivered, layer };
};

describe("contact.submit", () => {
  it.effect("delivers the message and answers 202", () => {
    const { delivered, layer } = setup(5);
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const response = yield* client.contact.submit({
        payload: message,
        responseMode: "response-only",
      });
      assert.strictEqual(response.status, 202);
      assert.deepStrictEqual(delivered, [message]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("answers 429 once the limit is used up, without delivering", () => {
    const { delivered, layer } = setup(2);
    return Effect.gen(function* () {
      const client = yield* makeClient;
      yield* client.contact.submit({ payload: message });
      yield* client.contact.submit({ payload: message });
      const error = yield* client.contact
        .submit({ payload: message })
        .pipe(Effect.flip);
      assert.instanceOf(error, RateLimited);
      assert.strictEqual(delivered.length, 2);
    }).pipe(Effect.provide(layer));
  });
});
