import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Sessions } from "#repositories/Sessions";
import { KernelTest, login, published, UsersTest } from "#testing/Users";
import { UserProfileChanged, UserRegistered } from "./User.ts";
import { UserCommands } from "./UserCommands.ts";
import { ModerationRepository } from "./ModerationRepository.ts";
import { UserQueries } from "./UserQueries.ts";
import { UserRepository } from "./UserRepository.ts";

describe("UserCommands.syncFromLogin", () => {
  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the user on the first login", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const { take } = yield* published;
        const subject = crypto.randomUUID();

        const user = yield* commands.syncFromLogin(login(subject));

        assert.strictEqual(user.subject, subject);
        assert.deepStrictEqual(yield* queries.getById(user.id), user);
        assert.deepStrictEqual(
          yield* queries.findBySubject(subject),
          Option.some(user),
        );
        assert.deepStrictEqual(yield* take, [
          new UserRegistered({ userId: user.id }),
        ]);
      }),
    );

    it.effect("grants normalUser at registration and keeps granted roles", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const sql = yield* SqlClient.SqlClient;
        const subject = crypto.randomUUID();
        assert.deepStrictEqual((yield* queries.accessOf(subject)).roles, []);

        const user = yield* commands.syncFromLogin(login(subject));
        assert.deepStrictEqual((yield* queries.accessOf(subject)).roles, [
          "normalUser",
        ]);

        // An operator grants admin; later logins neither duplicate
        // normalUser nor drop the granted role.
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES (${user.id}, 'admin')
        `;
        yield* commands.syncFromLogin(login(subject));
        assert.deepStrictEqual((yield* queries.accessOf(subject)).roles, [
          "admin",
          "normalUser",
        ]);
      }),
    );

    it.effect("updates the profile and last login on later logins", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const subject = crypto.randomUUID();
        const first = yield* commands.syncFromLogin(login(subject));
        const { take } = yield* published;

        yield* TestClock.adjust("1 hour");
        const unchanged = yield* commands.syncFromLogin(login(subject));
        assert.strictEqual(unchanged.id, first.id);
        assert.isTrue(
          DateTime.Equivalence(
            unchanged.lastLoginAt,
            DateTime.add(first.lastLoginAt, { hours: 1 }),
          ),
        );
        assert.isTrue(
          DateTime.Equivalence(unchanged.updatedAt, first.updatedAt),
        );
        assert.deepStrictEqual(yield* take, []);

        yield* TestClock.adjust("1 hour");
        const renamed = yield* commands.syncFromLogin(
          login(subject, { name: Option.some("Ada King") }),
        );
        assert.deepStrictEqual(renamed.name, Option.some("Ada King"));
        assert.deepStrictEqual(yield* queries.getById(first.id), renamed);
        assert.deepStrictEqual(yield* take, [
          new UserProfileChanged({ userId: first.id, fields: ["name"] }),
        ]);
      }),
    );

    it.effect("stores missing profile claims as NULL", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const sql = yield* SqlClient.SqlClient;
        const subject = crypto.randomUUID();
        yield* commands.syncFromLogin(
          login(subject, {
            username: Option.none(),
            name: Option.none(),
            email: Option.none(),
            emailVerified: false,
          }),
        );
        const [row] = yield* sql<{
          readonly username: string | null;
          readonly email: string | null;
        }>`SELECT username, email FROM users WHERE subject = ${subject}`;
        assert.deepStrictEqual(row, { username: null, email: null });
      }),
    );
  });

  let lookups = 0;
  it.effect(
    "continues as a repeated login when a concurrent first login won",
    () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const subject = crypto.randomUUID();
        // The other login inserts its user between our lookup and insert.
        const winner = yield* commands.syncFromLogin(login(subject));

        const user = yield* commands.syncFromLogin(
          login(subject, { username: Option.some("ada2") }),
        );

        // Lookup, missed lookup, insert conflict, lookup again.
        assert.strictEqual(lookups, 3);
        assert.strictEqual(user.id, winner.id);
        assert.deepStrictEqual(
          (yield* queries.getById(winner.id)).username,
          Option.some("ada2"),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(UserCommands.layer, UserQueries.layer).pipe(
            Layer.provide(
              Layer.effect(
                UserRepository,
                Effect.gen(function* () {
                  const repository = yield* UserRepository;

                  return UserRepository.of({
                    ...repository,
                    // The second command's first lookup misses the user.
                    findBySubjectForUpdate: (subject) =>
                      ++lookups === 2
                        ? Effect.succeedNone
                        : repository.findBySubjectForUpdate(subject),
                  });
                }),
              ).pipe(Layer.provide(UserRepository.layer)),
            ),
            Layer.provide([ModerationRepository.layer, Sessions.layer]),
            Layer.provideMerge(KernelTest),
          ),
        ),
      ),
    { timeout: 30_000 },
  );
});
