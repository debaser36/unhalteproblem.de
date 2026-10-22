import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import {
  ContactRateLimit,
  ContactRateLimitExceeded,
} from "./ContactRateLimit.ts";

const consumeExit = (key: string) =>
  Effect.gen(function* () {
    const rateLimit = yield* ContactRateLimit;
    return yield* rateLimit.consume(key).pipe(Effect.exit);
  });

const isExceeded = (exit: Exit.Exit<void, ContactRateLimitExceeded>) =>
  Option.match(Exit.findErrorOption(exit), {
    onNone: () => false,
    onSome: (error) => error instanceof ContactRateLimitExceeded,
  });

describe("ContactRateLimit", () => {
  it.effect("gives every client its own quota", () =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isSuccess(yield* consumeExit("a")));
      assert.isTrue(Exit.isSuccess(yield* consumeExit("a")));
      assert.isTrue(isExceeded(yield* consumeExit("a")));
      // Another client is unaffected by "a" running out.
      assert.isTrue(Exit.isSuccess(yield* consumeExit("b")));
    }).pipe(
      Effect.provide(
        ContactRateLimit.layerWith({
          limit: 2,
          globalLimit: 100,
          window: "1 hour",
        }),
      ),
    ),
  );

  it.effect("caps all clients together with the global limit", () =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isSuccess(yield* consumeExit("a")));
      assert.isTrue(Exit.isSuccess(yield* consumeExit("b")));
      assert.isTrue(Exit.isSuccess(yield* consumeExit("c")));
      assert.isTrue(isExceeded(yield* consumeExit("d")));
    }).pipe(
      Effect.provide(
        ContactRateLimit.layerWith({
          limit: 5,
          globalLimit: 3,
          window: "1 hour",
        }),
      ),
    ),
  );
});
