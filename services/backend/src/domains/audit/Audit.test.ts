import { assert, describe, layer } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Transaction } from "#cqrs/Transaction";
import { KernelTest } from "#testing/Users";
import { UserId } from "#domains/users/User";
import { AuditCommands } from "./AuditCommands.ts";
import { AuditRepository } from "./AuditRepository.ts";

const TestLayer = AuditCommands.layer.pipe(
  Layer.provideMerge(AuditRepository.layer),
  Layer.provideMerge(KernelTest),
);

const user = UserId.make("8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");

const rows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly action: string;
    readonly actorId: string | null;
    readonly detail: string | null;
  }>`SELECT action, actor_id, detail FROM audit_log ORDER BY id`;
});

const clear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM audit_log`;
});

describe("AuditCommands", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("appends an entry with ids and a detail", () =>
      Effect.gen(function* () {
        yield* clear;
        const audit = yield* AuditCommands;
        yield* audit.record({
          action: "role_granted",
          actor: Option.some(user),
          target: Option.none(),
          detail: "admin",
        });
        assert.deepStrictEqual(yield* rows, [
          { action: "role_granted", actorId: user, detail: "admin" },
        ]);
      }),
    );

    it.effect("is part of the transaction it is recorded in", () =>
      Effect.gen(function* () {
        yield* clear;
        const audit = yield* AuditCommands;
        const transaction = yield* Transaction;
        const exit = yield* transaction
          .run(
            audit
              .record({
                action: "logout",
                actor: Option.some(user),
                target: Option.some(user),
              })
              .pipe(Effect.andThen(Effect.fail("rolled back"))),
          )
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        assert.deepStrictEqual(yield* rows, []);
      }),
    );

    it.effect("purges only entries older than the retention", () =>
      Effect.gen(function* () {
        yield* clear;
        const audit = yield* AuditCommands;
        const entry = {
          action: "login" as const,
          actor: Option.some(user),
          target: Option.some(user),
        };
        yield* audit.record({ ...entry, detail: "old" });
        yield* TestClock.adjust("300 days");
        yield* audit.record({ ...entry, detail: "newer" });
        yield* TestClock.adjust("100 days");
        // "old" is 400 days old, "newer" 100.
        assert.strictEqual(yield* audit.purgeOlderThan("365 days"), 1);
        assert.deepStrictEqual(
          (yield* rows).map(({ detail }) => detail),
          ["newer"],
        );
        assert.strictEqual(yield* audit.purgeOlderThan("365 days"), 0);
      }),
    );
  });
});
