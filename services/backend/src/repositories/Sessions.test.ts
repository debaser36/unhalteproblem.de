import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { DatabaseTest } from "#testing/Database";
import { type NewSession, Sessions } from "./Sessions.ts";

const TestLayer = Sessions.layer.pipe(Layer.provideMerge(DatabaseTest));

const randomHash = () => crypto.getRandomValues(new Uint8Array(32));
const randomId = () => crypto.randomUUID();

const newSession = Effect.fnUntraced(function* (
  overrides: Partial<NewSession> = {},
) {
  const now = yield* DateTime.now;
  return {
    idHash: randomHash(),
    userId: randomId(),
    providerSessionId: Option.some(randomId()),
    idToken: "eyJhbGciOiJSUzI1NiJ9.payload.signature",
    claims: {
      preferred_username: "ada",
      name: "Ada Lovelace",
      email: "ada@example.org",
      email_verified: true,
    },
    expiresAt: DateTime.add(now, { hours: 8 }),
    ...overrides,
  } satisfies NewSession;
});

describe("Sessions", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("finds a session with all its fields", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const input = yield* newSession();
        yield* sessions.create(input);

        const session = Option.getOrThrow(yield* sessions.find(input.idHash));
        assert.deepStrictEqual(session.idHash, input.idHash);
        assert.strictEqual(session.userId, input.userId);
        assert.deepStrictEqual(
          session.providerSessionId,
          input.providerSessionId,
        );
        assert.strictEqual(Redacted.value(session.idToken), input.idToken);
        assert.deepStrictEqual(session.claims, input.claims);
        assert.isTrue(DateTime.Equivalence(session.expiresAt, input.expiresAt));
        // The ID token stays out of logs.
        assert.notInclude(String(session.idToken), input.idToken);
        assert.notInclude(JSON.stringify(session), input.idToken);
      }),
    );

    it.effect("stores the claims as jsonb with their OIDC names", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const sql = yield* SqlClient.SqlClient;
        const input = yield* newSession();
        yield* sessions.create(input);

        const [row] = yield* sql<{ readonly username: string }>`
          SELECT claims->>'preferred_username' AS username
          FROM auth_sessions WHERE id_hash = ${input.idHash}
        `;
        assert.strictEqual(row?.username, "ada");
      }),
    );

    it.effect("decodes partial claims and drops unknown ones", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const sql = yield* SqlClient.SqlClient;
        const idHash = randomHash();
        yield* sql`
          INSERT INTO auth_sessions (id_hash, user_id, id_token, claims, expires_at)
          VALUES (
            ${idHash}, ${randomId()}, 'token',
            ${JSON.stringify({ email: "ada@example.org", groups: ["admin"] })},
            ${DateTime.toDateUtc(DateTime.add(yield* DateTime.now, { hours: 1 }))}
          )
        `;

        const session = Option.getOrThrow(yield* sessions.find(idHash));
        assert.deepStrictEqual(session.claims, { email: "ada@example.org" });
        assert.isTrue(Option.isNone(session.providerSessionId));
      }),
    );

    it.effect("keeps a session without a provider session id", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const input = yield* newSession({ providerSessionId: Option.none() });
        yield* sessions.create(input);

        const session = Option.getOrThrow(yield* sessions.find(input.idHash));
        assert.isTrue(Option.isNone(session.providerSessionId));
      }),
    );

    it.effect("doesn't find an expired session", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const input = yield* newSession();
        yield* sessions.create(input);

        yield* TestClock.adjust("8 hours");
        assert.isTrue(Option.isNone(yield* sessions.find(input.idHash)));
      }),
    );

    it.effect("deletes a session and returns it, even once expired", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const input = yield* newSession();
        yield* sessions.create(input);
        yield* TestClock.adjust("9 hours");

        const deleted = Option.getOrThrow(yield* sessions.delete(input.idHash));
        assert.strictEqual(Redacted.value(deleted.idToken), input.idToken);
        assert.isTrue(Option.isNone(yield* sessions.delete(input.idHash)));
      }),
    );

    it.effect("deletes all sessions of a provider session", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const sid = randomId();
        const same = [
          yield* newSession({ providerSessionId: Option.some(sid) }),
          yield* newSession({ providerSessionId: Option.some(sid) }),
        ];
        const other = yield* newSession();
        yield* Effect.forEach([...same, other], sessions.create);

        assert.strictEqual(yield* sessions.deleteByProviderSession(sid), 2);
        for (const session of same) {
          assert.isTrue(Option.isNone(yield* sessions.find(session.idHash)));
        }
        assert.isTrue(Option.isSome(yield* sessions.find(other.idHash)));
        assert.strictEqual(yield* sessions.deleteByProviderSession(sid), 0);
      }),
    );

    it.effect("deletes all sessions of a user", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const userId = randomId();
        const same = [
          yield* newSession({ userId }),
          yield* newSession({ userId, providerSessionId: Option.none() }),
        ];
        const other = yield* newSession();
        yield* Effect.forEach([...same, other], sessions.create);

        assert.strictEqual(yield* sessions.deleteByUser(userId), 2);
        for (const session of same) {
          assert.isTrue(Option.isNone(yield* sessions.find(session.idHash)));
        }
        assert.isTrue(Option.isSome(yield* sessions.find(other.idHash)));
      }),
    );

    it.effect("rejects a second session with the same id", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const input = yield* newSession();
        yield* sessions.create(input);

        const error = yield* Effect.flip(sessions.create(input));
        assert.strictEqual(error._tag, "SqlError");
      }),
    );
  });

  // A database of its own, so the count only covers this test's rows.
  it.effect(
    "deletes only expired sessions",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const now = yield* DateTime.now;
        const expiring = yield* newSession({
          expiresAt: DateTime.add(now, { hours: 1 }),
        });
        const valid = yield* newSession({
          expiresAt: DateTime.add(now, { hours: 2 }),
        });
        yield* Effect.forEach([expiring, valid], sessions.create);

        yield* TestClock.adjust("1 hour");
        assert.strictEqual(yield* sessions.deleteExpired, 1);
        assert.strictEqual(yield* sessions.deleteExpired, 0);
        assert.isTrue(Option.isSome(yield* sessions.find(valid.idHash)));
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );
});
