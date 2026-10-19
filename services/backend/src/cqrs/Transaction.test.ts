import { assert, describe, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, PubSub, Queue, Schema } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { DatabaseTest } from "#testing/Database";
import * as Command from "./Command.ts";
import * as DomainEvent from "./DomainEvent.ts";
import * as Query from "./Query.ts";
import { Transaction } from "./Transaction.ts";

class Happened extends Schema.TaggedClass<
  Happened,
  { readonly brand: unique symbol }
>()("Happened", { n: Schema.Finite }) {}

class Refused extends Schema.TaggedError<
  Refused,
  { readonly brand: unique symbol }
>()("Refused", {}) {}

const TestLayer = Transaction.layer.pipe(
  Layer.provideMerge(DomainEvent.DomainEvents.layer),
  Layer.provideMerge(DatabaseTest),
);

/** Subscribes now; `take` returns what was published since. */
const published = Effect.gen(function* () {
  const domainEvents = yield* DomainEvent.DomainEvents;
  const subscription = yield* domainEvents.subscribe;
  return { take: PubSub.takeUpTo(subscription, 100) };
});

const insertRow = Effect.fnUntraced(function* (n: number) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO cqrs_test (n) VALUES (${n})`;
});

/** An empty `cqrs_test` table. */
const clear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS cqrs_test (n int NOT NULL)`;
  yield* sql`DELETE FROM cqrs_test`;
});

const rows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const result = yield* sql<{
    readonly n: number;
  }>`SELECT n FROM cqrs_test ORDER BY n`;
  return result.map((row) => row.n);
});

describe("Transaction", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("publishes recorded events after the commit", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const { take } = yield* published;
        yield* clear;

        yield* transaction.run(
          Effect.gen(function* () {
            yield* insertRow(1);
            yield* DomainEvent.record(new Happened({ n: 1 }));
            // Nothing is published before the commit.
            assert.deepStrictEqual(yield* take, []);
          }),
        );

        assert.deepStrictEqual(yield* take, [new Happened({ n: 1 })]);
        assert.deepStrictEqual(yield* rows, [1]);
      }),
    );

    it.effect("drops the events of a rolled back transaction", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const { take } = yield* published;
        yield* clear;

        const exit = yield* transaction
          .run(
            Effect.gen(function* () {
              yield* insertRow(2);
              yield* DomainEvent.record(new Happened({ n: 2 }));
              return yield* new Refused();
            }),
          )
          .pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        assert.deepStrictEqual(yield* take, []);
        assert.deepStrictEqual(yield* rows, []);
      }),
    );

    it.effect("a failed nested run drops its own changes and events only", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const { take } = yield* published;
        yield* clear;

        yield* transaction.run(
          Effect.gen(function* () {
            yield* insertRow(3);
            yield* DomainEvent.record(new Happened({ n: 3 }));
            yield* transaction
              .run(
                Effect.gen(function* () {
                  yield* insertRow(4);
                  yield* DomainEvent.record(new Happened({ n: 4 }));
                  return yield* new Refused();
                }),
              )
              .pipe(Effect.catchTag("Refused", () => Effect.void));
            yield* transaction.run(
              Effect.gen(function* () {
                yield* insertRow(5);
                yield* DomainEvent.record(new Happened({ n: 5 }));
              }),
            );
            // A successful nested run doesn't publish on its own.
            assert.deepStrictEqual(yield* take, []);
          }),
        );

        assert.deepStrictEqual(yield* take, [
          new Happened({ n: 3 }),
          new Happened({ n: 5 }),
        ]);
        assert.deepStrictEqual(yield* rows, [3, 5]);
      }),
    );

    it.effect("recording outside a transaction is a defect", () =>
      Effect.gen(function* () {
        const exit = yield* DomainEvent.record(new Happened({ n: 0 })).pipe(
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect("recording after the transaction ended is a defect", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        // The context of a fiber that outlives its transaction.
        const context = yield* transaction.run(Effect.context<never>());
        const exit = yield* DomainEvent.record(new Happened({ n: 0 })).pipe(
          Effect.provideContext(context),
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect("a run inside a bare sql.withTransaction is a defect", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const sql = yield* SqlClient.SqlClient;
        const exit = yield* sql
          .withTransaction(transaction.run(Effect.void))
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect(
      "recording inside a bare nested sql.withTransaction is a defect",
      () =>
        Effect.gen(function* () {
          const transaction = yield* Transaction;
          const sql = yield* SqlClient.SqlClient;
          const { take } = yield* published;
          const exit = yield* transaction
            .run(
              sql.withTransaction(DomainEvent.record(new Happened({ n: 0 }))),
            )
            .pipe(Effect.exit);
          assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
          assert.deepStrictEqual(yield* take, []);
        }),
    );

    it.effect("a subscriber continues after a failing handler", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const handled = yield* Queue.unbounded<number>();
        yield* Layer.build(
          DomainEvent.subscriber("TestSubscriber", Happened, (event) =>
            event.n === 1
              ? Effect.die(new Error("boom"))
              : Queue.offer(handled, event.n),
          ),
        );

        for (const n of [1, 2]) {
          yield* transaction.run(DomainEvent.record(new Happened({ n })));
        }

        assert.strictEqual(yield* Queue.take(handled), 2);
      }),
    );
  });
});

describe("boundaries", () => {
  const sqlError = new SqlError.SqlError({
    reason: new SqlError.UnknownError({ cause: new Error("connection lost") }),
  });

  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("Query.boundary turns infrastructure errors into defects", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.fail(sqlError).pipe(
          Query.boundary,
          Effect.exit,
        );
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect(
      "the defect names the kind of failure and nothing it quoted",
      () =>
        Effect.gen(function* () {
          const quoting = new SqlError.SqlError({
            reason: new SqlError.UnknownError({
              cause: new Error("Failing row contains (ada@example.org, Ada)"),
            }),
          });
          const exit = yield* Effect.fail(quoting).pipe(
            Query.boundary,
            Effect.exit,
          );
          assert.isTrue(Exit.isFailure(exit));
          const text = Cause.pretty(
            (exit as Exit.Failure<unknown, unknown>).cause,
          );
          assert.include(text, "Database error (UnknownError)");
          assert.notInclude(text, "ada@example.org");
          assert.notInclude(text, "Failing row");
        }),
    );

    it.effect("Query.boundary keeps domain errors", () =>
      Effect.gen(function* () {
        const exit = yield* new Refused().pipe(Query.boundary, Effect.exit);
        assert.deepStrictEqual(exit, Exit.fail(new Refused()));
      }),
    );

    it.effect("Command.boundary runs in a transaction", () =>
      Effect.gen(function* () {
        const transaction = yield* Transaction;
        const { take } = yield* published;
        const command = Effect.fn("TestCommand")(function* (n: number) {
          yield* DomainEvent.record(new Happened({ n }));
          return n;
        }, Command.boundary(transaction));

        assert.strictEqual(yield* command(7), 7);
        assert.deepStrictEqual(yield* take, [new Happened({ n: 7 })]);
      }),
    );
  });
});
