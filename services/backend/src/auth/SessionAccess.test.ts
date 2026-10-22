import { assert, describe, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import { Sessions } from "./Sessions.ts";
import { asAdmin, asSuperAdmin, member, UsersTest } from "#testing/Users";
import { hashSecret } from "./Secrets.ts";
import { SessionAccess } from "./SessionAccess.ts";

const TestLayer = SessionAccess.layer.pipe(Layer.provideMerge(UsersTest));

/** A session for `subject`, as login would store it; returns its cookie hash. */
const startSession = Effect.fnUntraced(function* (subject: string) {
  const sessions = yield* Sessions;
  const idHash = hashSecret(crypto.randomUUID());
  const now = yield* DateTime.now;
  yield* sessions.create({
    idHash,
    userId: subject,
    providerSessionId: Option.none(),
    claims: { preferred_username: "ada", email_verified: true },
    expiresAt: DateTime.add(now, { hours: 8 }),
  });
  return idHash;
});

describe("SessionAccess", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("returns the session with the user's roles", () =>
      Effect.gen(function* () {
        const access = yield* SessionAccess;
        const sessions = yield* Sessions;
        const admin = yield* member("admin", "superAdmin");
        const idHash = yield* startSession(admin.subject);

        const found = Option.getOrThrow(yield* access.find(idHash));
        assert.deepStrictEqual(found.roles, [
          "admin",
          "normalUser",
          "superAdmin",
        ]);
        assert.isFalse(found.restricted);
        // The stored fields are the session's own.
        const session = Option.getOrThrow(yield* sessions.find(idHash));
        assert.strictEqual(found.userId, session.userId);
        assert.deepStrictEqual(found.claims, session.claims);
        assert.isTrue(DateTime.Equivalence(found.expiresAt, session.expiresAt));
      }),
    );

    it.effect("agrees with ModerationRepository.accessOf", () =>
      Effect.gen(function* () {
        const access = yield* SessionAccess;
        const moderation = yield* ModerationQueries;
        const commands = yield* ModerationCommands;
        const admin = yield* member("admin");
        const target = yield* member();
        yield* commands
          .restrict(target.user.id, "spam")
          .pipe(asAdmin(admin), Effect.orDie);

        for (const subject of [admin.subject, target.subject]) {
          const idHash = yield* startSession(subject);
          const found = Option.getOrThrow(yield* access.find(idHash));
          const expected = yield* moderation.accessOf(subject);
          assert.deepStrictEqual(found.roles, expected.roles);
          assert.strictEqual(found.restricted, expected.restricted);
        }
        const restricted = yield* startSession(target.subject);
        assert.isTrue(
          Option.getOrThrow(yield* access.find(restricted)).restricted,
        );
      }),
    );

    it.effect("sees a lifted restriction as lifted", () =>
      Effect.gen(function* () {
        const access = yield* SessionAccess;
        const commands = yield* ModerationCommands;
        const admin = yield* member("admin");
        const target = yield* member();
        yield* commands
          .restrict(target.user.id, "spam")
          .pipe(asAdmin(admin), Effect.orDie);
        yield* commands
          .liftRestriction(target.user.id, Option.none())
          .pipe(asAdmin(admin), Effect.orDie);
        const idHash = yield* startSession(target.subject);
        assert.isFalse(
          Option.getOrThrow(yield* access.find(idHash)).restricted,
        );
      }),
    );

    it.effect("sees a role change at once", () =>
      Effect.gen(function* () {
        const access = yield* SessionAccess;
        const commands = yield* ModerationCommands;
        const root = yield* member("superAdmin");
        const target = yield* member();
        const idHash = yield* startSession(target.subject);
        assert.deepStrictEqual(
          Option.getOrThrow(yield* access.find(idHash)).roles,
          ["normalUser"],
        );
        yield* commands
          .grantRole(target.user.id, "admin")
          .pipe(asSuperAdmin(root), Effect.orDie);
        assert.deepStrictEqual(
          Option.getOrThrow(yield* access.find(idHash)).roles,
          ["admin", "normalUser"],
        );
      }),
    );

    it.effect(
      "has no roles and no restriction for a user we have no row for",
      () =>
        Effect.gen(function* () {
          const access = yield* SessionAccess;
          const idHash = yield* startSession(crypto.randomUUID());
          const found = Option.getOrThrow(yield* access.find(idHash));
          assert.deepStrictEqual(found.roles, []);
          assert.isFalse(found.restricted);
        }),
    );

    it.effect("finds nothing for an unknown or expired session", () =>
      Effect.gen(function* () {
        const access = yield* SessionAccess;
        const idHash = yield* startSession(crypto.randomUUID());
        assert.isTrue(
          Option.isNone(yield* access.find(hashSecret("not a session"))),
        );
        yield* TestClock.adjust("9 hours");
        assert.isTrue(Option.isNone(yield* access.find(idHash)));
      }),
    );
  });
});
