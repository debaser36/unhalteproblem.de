import { AccountDeletionNotAllowed } from "@unhalteproblem.de/api";
import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Outbox } from "#cqrs/Outbox";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { Sessions } from "#repositories/Sessions";
import { hashSecret } from "#auth/Secrets";
import { makeRecordingKeycloak } from "#testing/KeycloakAdmin";
import { login, member, published, UsersTest } from "#testing/Users";
import { DeleteKeycloakUser, KeycloakUserDeletion } from "./AccountDeletion.ts";
import { AccountDeleted } from "./User.ts";
import { UserCommands } from "./UserCommands.ts";
import { UserQueries } from "./UserQueries.ts";

const startSession = Effect.fnUntraced(function* (subject: string) {
  const sessions = yield* Sessions;
  const now = yield* DateTime.now;
  yield* sessions.create({
    idHash: hashSecret(crypto.randomUUID()),
    userId: subject,
    providerSessionId: Option.some(crypto.randomUUID()),
    claims: { email: "ada@example.org" },
    expiresAt: DateTime.add(now, { hours: 8 }),
  });
});

describe("UserCommands.deleteAccount", () => {
  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    it.effect(
      "anonymises the user and removes everything that belonged to them",
      () =>
        Effect.gen(function* () {
          const commands = yield* UserCommands;
          const queries = yield* UserQueries;
          const moderation = yield* ModerationQueries;
          const sql = yield* SqlClient.SqlClient;
          const { take } = yield* published;
          const ada = yield* member("admin");
          yield* startSession(ada.subject);
          yield* startSession(ada.subject);
          yield* TestClock.adjust("1 hour");
          const now = yield* DateTime.now;

          yield* commands.deleteAccount(ada.subject);

          // The tombstone: no profile, deleted now; the id and subject stay.
          const user = yield* queries.getById(ada.user.id);
          assert.strictEqual(user.subject, ada.subject);
          assert.deepStrictEqual(
            [user.username, user.name, user.email, user.emailVerified],
            [Option.none(), Option.none(), Option.none(), false],
          );
          assert.deepStrictEqual(user.deletedAt, Option.some(now));
          // No roles, and blocked like a restricted user.
          assert.deepStrictEqual(yield* moderation.accessOf(ada.subject), {
            roles: [],
            restricted: true,
          });
          // The removal is in the role change log, with no actor.
          const changes = yield* sql<{
            readonly role: string;
            readonly change: string;
            readonly changedBy: string | null;
          }>`
          SELECT role, change, changed_by FROM user_role_changes
          WHERE user_id = ${ada.user.id} AND change = 'revoked' ORDER BY role
        `;
          assert.deepStrictEqual(changes, [
            { role: "admin", change: "revoked", changedBy: null },
            { role: "normalUser", change: "revoked", changedBy: null },
          ]);
          // All sessions are gone.
          assert.strictEqual(
            (yield* sql`SELECT 1 FROM auth_sessions WHERE user_id = ${ada.subject}`)
              .length,
            0,
          );
          // Audited with ids only.
          assert.deepStrictEqual(
            yield* sql`
            SELECT action, actor_id, target_id, detail FROM audit_log
            WHERE action = 'account_deleted'
          `,
            [
              {
                action: "account_deleted",
                actorId: ada.user.id,
                targetId: ada.user.id,
                detail: null,
              },
            ],
          );
          // Keycloak is to be told, durably, by id.
          const outbox = yield* Outbox;
          const asked: Array<string> = [];
          yield* outbox.process(DeleteKeycloakUser, ({ subject }) =>
            Effect.sync(() => void asked.push(subject)),
          );
          assert.deepStrictEqual(asked, [ada.subject]);
          assert.deepStrictEqual(
            (yield* take).filter((event) => event._tag === "AccountDeleted"),
            [new AccountDeleted({ userId: ada.user.id })],
          );
        }),
    );

    it.effect("does nothing the second time", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const sql = yield* SqlClient.SqlClient;
        const ada = yield* member();
        yield* commands.deleteAccount(ada.subject);
        yield* commands.deleteAccount(ada.subject);
        for (const table of ["audit_log", "outbox"]) {
          const rows = yield* sql<{ readonly n: number }>`
            SELECT count(*)::int AS n FROM ${sql(table)}
            WHERE ${table === "audit_log" ? sql`target_id = ${ada.user.id}` : sql`payload->>'subject' = ${ada.subject}`}
          `;
          assert.strictEqual(rows[0]?.n, 1, table);
        }
      }),
    );

    it.effect("is refused for a superAdmin, who keeps everything", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const moderation = yield* ModerationQueries;
        const sql = yield* SqlClient.SqlClient;
        const root = yield* member("admin", "superAdmin");
        yield* startSession(root.subject);

        const error = yield* commands
          .deleteAccount(root.subject)
          .pipe(Effect.flip);
        assert.instanceOf(error, AccountDeletionNotAllowed);

        const user = yield* queries.getById(root.user.id);
        assert.deepStrictEqual(user.deletedAt, Option.none());
        assert.deepStrictEqual(user.name, root.user.name);
        assert.deepStrictEqual(yield* moderation.accessOf(root.subject), {
          roles: ["admin", "normalUser", "superAdmin"],
          restricted: false,
        });
        assert.strictEqual(
          (yield* sql`SELECT 1 FROM auth_sessions WHERE user_id = ${root.subject}`)
            .length,
          1,
        );
        assert.strictEqual(
          (yield* sql`SELECT 1 FROM audit_log WHERE target_id = ${root.user.id}`)
            .length,
          0,
        );
      }),
    );

    it.effect("is not undone by a login that slips in afterwards", () =>
      Effect.gen(function* () {
        const commands = yield* UserCommands;
        const queries = yield* UserQueries;
        const ada = yield* member();
        yield* commands.deleteAccount(ada.subject);

        const again = yield* commands.syncFromLogin(login(ada.subject));
        assert.deepStrictEqual(again.name, Option.none());
        assert.isTrue(
          Option.isSome((yield* queries.getById(ada.user.id)).deletedAt),
        );
      }),
    );
  });
});

describe("KeycloakUserDeletion", () => {
  it.live("asks Keycloak to delete the user in the background", () =>
    Effect.gen(function* () {
      const commands = yield* UserCommands;
      const keycloak = makeRecordingKeycloak();
      yield* Layer.build(
        KeycloakUserDeletion.pipe(Layer.provide(keycloak.layer)),
      );
      const ada = yield* member();
      yield* commands.deleteAccount(ada.subject);
      // The consumer polls; wait for it, with a bound.
      for (let i = 0; i < 100 && keycloak.deleted.length === 0; i++) {
        yield* Effect.sleep("100 millis");
      }
      assert.deepStrictEqual(keycloak.deleted, [ada.subject]);
    }).pipe(Effect.scoped, Effect.provide(UsersTest)),
  );
});
