import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { DatabaseTest } from "#testing/Database";
import { LoginAttempts, type NewLoginAttempt } from "./LoginAttempts.ts";

const TestLayer = LoginAttempts.layer.pipe(Layer.provideMerge(DatabaseTest));

const randomHash = () => crypto.getRandomValues(new Uint8Array(32));

const newAttempt = Effect.fnUntraced(function* (
  overrides: Partial<NewLoginAttempt> = {},
) {
  const now = yield* DateTime.now;
  return {
    idHash: randomHash(),
    state: "state-value",
    nonce: "nonce-value",
    codeVerifier: "code-verifier-value",
    returnTo: "/blog?page=2",
    expiresAt: DateTime.add(now, { minutes: 10 }),
    ...overrides,
  } satisfies NewLoginAttempt;
});

describe("LoginAttempts", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("takes an attempt with all its fields", () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        const input = yield* newAttempt();
        yield* attempts.create(input);

        const taken = yield* attempts.take(input.idHash);
        assert.isTrue(Option.isSome(taken));
        const attempt = Option.getOrThrow(taken);
        assert.deepStrictEqual(attempt.idHash, input.idHash);
        assert.strictEqual(attempt.state, input.state);
        assert.strictEqual(attempt.nonce, input.nonce);
        assert.strictEqual(
          Redacted.value(attempt.codeVerifier),
          input.codeVerifier,
        );
        assert.strictEqual(attempt.returnTo, input.returnTo);
        assert.isTrue(DateTime.Equivalence(attempt.expiresAt, input.expiresAt));
        // The PKCE secret stays out of logs.
        assert.notInclude(String(attempt.codeVerifier), input.codeVerifier);
      }),
    );

    it.effect("is single-use", () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        const input = yield* newAttempt();
        yield* attempts.create(input);

        assert.isTrue(Option.isSome(yield* attempts.take(input.idHash)));
        assert.isTrue(Option.isNone(yield* attempts.take(input.idHash)));
      }),
    );

    it.effect("gives exactly one of two concurrent takes the attempt", () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        const input = yield* newAttempt();
        yield* attempts.create(input);

        const results = yield* Effect.all(
          [attempts.take(input.idHash), attempts.take(input.idHash)],
          { concurrency: 2 },
        );
        assert.strictEqual(results.filter(Option.isSome).length, 1);
      }),
    );

    it.effect("doesn't return an expired attempt, and removes it", () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        const sql = yield* SqlClient.SqlClient;
        const input = yield* newAttempt();
        yield* attempts.create(input);

        yield* TestClock.adjust("10 minutes");
        assert.isTrue(Option.isNone(yield* attempts.take(input.idHash)));
        const left = yield* sql`
          SELECT 1 FROM auth_login_attempts WHERE id_hash = ${input.idHash}
        `;
        assert.strictEqual(left.length, 0);
      }),
    );

    it.effect("returns None for an unknown id", () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        assert.isTrue(Option.isNone(yield* attempts.take(randomHash())));
      }),
    );
  });

  // A database of its own, so the count only covers this test's rows.
  it.effect(
    "deletes only expired attempts",
    () =>
      Effect.gen(function* () {
        const attempts = yield* LoginAttempts;
        const now = yield* DateTime.now;
        const expiring = [
          yield* newAttempt({ expiresAt: DateTime.add(now, { minutes: 5 }) }),
          yield* newAttempt({ expiresAt: DateTime.add(now, { minutes: 10 }) }),
        ];
        const valid = yield* newAttempt({
          expiresAt: DateTime.add(now, { minutes: 11 }),
        });
        yield* Effect.forEach([...expiring, valid], attempts.create);

        yield* TestClock.adjust("10 minutes");
        assert.strictEqual(yield* attempts.deleteExpired, 2);
        assert.strictEqual(yield* attempts.deleteExpired, 0);
        assert.isTrue(Option.isSome(yield* attempts.take(valid.idHash)));
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );
});
