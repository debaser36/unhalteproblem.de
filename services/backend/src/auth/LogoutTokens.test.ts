import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { DatabaseTest } from "#testing/Database";
import { LogoutTokens } from "./LogoutTokens.ts";

const TestLayer = LogoutTokens.layer.pipe(Layer.provideMerge(DatabaseTest));

const inMinutes = (minutes: number) =>
  Effect.map(DateTime.now, (now) => DateTime.add(now, { minutes }));

describe("LogoutTokens", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("remembers a new token and detects its replay", () =>
      Effect.gen(function* () {
        const tokens = yield* LogoutTokens;
        const jti = crypto.randomUUID();
        const expiresAt = yield* inMinutes(2);

        assert.isTrue(yield* tokens.remember(jti, expiresAt));
        assert.isFalse(yield* tokens.remember(jti, expiresAt));
      }),
    );

    it.effect("detects a replay even when it arrives concurrently", () =>
      Effect.gen(function* () {
        const tokens = yield* LogoutTokens;
        const jti = crypto.randomUUID();
        const expiresAt = yield* inMinutes(2);

        const results = yield* Effect.all(
          [tokens.remember(jti, expiresAt), tokens.remember(jti, expiresAt)],
          { concurrency: 2 },
        );
        assert.deepStrictEqual([...results].sort(), [false, true]);
      }),
    );
  });

  // A database of its own, so the count only covers this test's rows.
  it.effect(
    "forgets only expired tokens",
    () =>
      Effect.gen(function* () {
        const tokens = yield* LogoutTokens;
        const expiring = crypto.randomUUID();
        const valid = crypto.randomUUID();
        assert.isTrue(yield* tokens.remember(expiring, yield* inMinutes(2)));
        assert.isTrue(yield* tokens.remember(valid, yield* inMinutes(5)));

        yield* TestClock.adjust("2 minutes");
        assert.strictEqual(yield* tokens.deleteExpired, 1);
        assert.strictEqual(yield* tokens.deleteExpired, 0);
        // Still remembered until it expires; the forgotten one is new again
        // (its token has expired by now, so verification rejects it anyway).
        assert.isFalse(yield* tokens.remember(valid, yield* inMinutes(3)));
        assert.isTrue(yield* tokens.remember(expiring, yield* inMinutes(2)));
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );
});
