import { assert, describe, it, layer } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
} from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { DatabaseTest } from "#testing/Database";
import { DomainEvents } from "./DomainEvent.ts";
import * as Outbox from "./Outbox.ts";
import { Transaction } from "./Transaction.ts";

class Boom extends Schema.TaggedError<
  Boom,
  { readonly brand: unique symbol }
>()("Boom", { secret: Schema.String }) {}

const TestLayer = Outbox.Outbox.layer.pipe(
  Layer.provideMerge(Transaction.layer),
  Layer.provideMerge(DomainEvents.layer),
  Layer.provideMerge(DatabaseTest),
);

const Payload = Schema.Struct({ n: Schema.Int, to: Schema.String });

/** A topic of its own per test, so tests share the database without clashing. */
let counter = 0;
const freshTopic = () => Outbox.topic(`test.topic-${counter++}`, Payload);

const send = Effect.fnUntraced(function* (
  topic: Outbox.Topic<typeof Payload.Type, typeof Payload.Encoded>,
  ...payloads: ReadonlyArray<typeof Payload.Type>
) {
  const outbox = yield* Outbox.Outbox;
  const transaction = yield* Transaction;
  yield* transaction.run(
    Effect.forEach(payloads, (payload) => outbox.enqueue(topic, payload)),
  );
});

const rowsOf = Effect.fnUntraced(function* (topicName: string) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly attempts: number;
    readonly lastError: string | null;
    readonly dead: boolean;
    readonly payload: unknown;
  }>`
    SELECT attempts, last_error, dead_at IS NOT NULL AS dead, payload
    FROM outbox WHERE topic = ${topicName} ORDER BY id
  `;
});

describe("Outbox", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("hands a committed message to the handler and deletes it", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "a" }, { n: 2, to: "b" });
        const seen: Array<typeof Payload.Type> = [];
        const claimed = yield* outbox.process(topic, (payload) =>
          Effect.sync(() => void seen.push(payload)),
        );
        assert.strictEqual(claimed, 2);
        assert.deepStrictEqual(seen, [
          { n: 1, to: "a" },
          { n: 2, to: "b" },
        ]);
        assert.deepStrictEqual(yield* rowsOf(topic.name), []);
        assert.strictEqual(yield* outbox.process(topic, () => Effect.void), 0);
      }),
    );

    it.effect("drops messages whose transaction rolls back", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const transaction = yield* Transaction;
        const topic = freshTopic();
        const exit = yield* transaction
          .run(
            outbox
              .enqueue(topic, { n: 1, to: "a" })
              .pipe(Effect.andThen(Effect.fail("rolled back"))),
          )
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        assert.deepStrictEqual(yield* rowsOf(topic.name), []);
      }),
    );

    it.effect("keeps a message enqueued in a savepoint that succeeded", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const transaction = yield* Transaction;
        const topic = freshTopic();
        yield* transaction.run(
          transaction.run(outbox.enqueue(topic, { n: 1, to: "a" })),
        );
        assert.strictEqual((yield* rowsOf(topic.name)).length, 1);
      }),
    );

    it.effect("dies when enqueueing outside a transaction", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const exit = yield* outbox
          .enqueue(freshTopic(), { n: 1, to: "a" })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect("retries a failed message later and records only its kind", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "someone@example.org" });
        const options = { backoff: () => Duration.minutes(1) };
        const failing = () =>
          Effect.fail(new Boom({ secret: "someone@example.org" }));

        assert.strictEqual(yield* outbox.process(topic, failing, options), 1);
        const [row] = yield* rowsOf(topic.name);
        assert.strictEqual(row?.attempts, 1);
        assert.strictEqual(row?.lastError, "Boom");
        assert.isFalse(row?.dead);

        // Not due yet.
        assert.strictEqual(yield* outbox.process(topic, failing, options), 0);

        yield* TestClock.adjust("61 seconds");
        const seen: Array<number> = [];
        assert.strictEqual(
          yield* outbox.process(
            topic,
            ({ n }) => Effect.sync(() => void seen.push(n)),
            options,
          ),
          1,
        );
        assert.deepStrictEqual(seen, [1]);
        assert.deepStrictEqual(yield* rowsOf(topic.name), []);
      }),
    );

    it.effect("gives up after the maximum number of attempts", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "a" });
        const options = { maxAttempts: 2, backoff: () => Duration.zero };
        const failing = () => Effect.die("nope");

        yield* outbox.process(topic, failing, options);
        yield* TestClock.adjust("1 second");
        yield* outbox.process(topic, failing, options);
        const [row] = yield* rowsOf(topic.name);
        assert.strictEqual(row?.attempts, 2);
        assert.strictEqual(row?.lastError, "defect");
        assert.isTrue(row?.dead);

        yield* TestClock.adjust("1 hour");
        assert.strictEqual(
          yield* outbox.process(topic, () => Effect.void, options),
          0,
        );
      }),
    );

    it.effect("fails a message whose payload no longer decodes", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const sql = yield* SqlClient.SqlClient;
        const topic = freshTopic();
        yield* sql`
          INSERT INTO outbox (topic, payload, created_at, available_at)
          VALUES (${topic.name}, '{"n":"x"}'::jsonb, to_timestamp(0), to_timestamp(0))
        `;
        yield* TestClock.adjust("1 second");
        const seen: Array<unknown> = [];
        const claimed = yield* outbox.process(topic, (payload) =>
          Effect.sync(() => void seen.push(payload)),
        );
        // Claimed, not handled, left for a retry.
        assert.strictEqual(claimed, 1);
        assert.deepStrictEqual(seen, []);
        assert.strictEqual((yield* rowsOf(topic.name)).length, 1);
      }),
    );

    it.effect("does not hand out a message while its lease holds", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const sql = yield* SqlClient.SqlClient;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "a" });
        // As left by a worker that died mid-message: claimed, lease running.
        const now = yield* DateTime.now;
        yield* sql`
          UPDATE outbox
          SET attempts = 1,
              locked_until = ${DateTime.toDateUtc(DateTime.add(now, { minutes: 5 }))}
          WHERE topic = ${topic.name}
        `;
        assert.strictEqual(yield* outbox.process(topic, () => Effect.void), 0);

        yield* TestClock.adjust("6 minutes");
        assert.strictEqual(yield* outbox.process(topic, () => Effect.void), 1);
        assert.deepStrictEqual(yield* rowsOf(topic.name), []);
      }),
    );

    it.effect("gives up on a message that keeps killing its workers", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const sql = yield* SqlClient.SqlClient;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "a" });
        // Claimed twice, never reported back, lease long gone.
        yield* sql`
          UPDATE outbox SET attempts = 2, locked_until = to_timestamp(1)
          WHERE topic = ${topic.name}
        `;
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(
          yield* outbox.process(topic, () => Effect.void, { maxAttempts: 2 }),
          0,
        );
        const [row] = yield* rowsOf(topic.name);
        assert.isTrue(row?.dead);
        assert.strictEqual(row?.lastError, "abandoned");
      }),
    );

    it.effect(
      "leaves a message alone that someone else claimed meanwhile",
      () =>
        Effect.gen(function* () {
          const outbox = yield* Outbox.Outbox;
          const sql = yield* SqlClient.SqlClient;
          const topic = freshTopic();
          yield* send(topic, { n: 1, to: "a" });
          // The handler is slow; meanwhile its lease ran out and another
          // worker claimed the message (attempts moved on).
          yield* outbox.process(topic, () =>
            sql`UPDATE outbox SET attempts = attempts + 1 WHERE topic = ${topic.name}`.pipe(
              Effect.orDie,
            ),
          );
          const [row] = yield* rowsOf(topic.name);
          assert.strictEqual(row?.attempts, 2);
        }),
    );

    it.effect(
      "treats an interruption inside a handler as a failed attempt",
      () =>
        Effect.gen(function* () {
          const outbox = yield* Outbox.Outbox;
          const topic = freshTopic();
          yield* send(topic, { n: 1, to: "a" });
          const claimed = yield* outbox.process(topic, () => Effect.interrupt);
          // Still running: the pass did not end with the handler.
          assert.strictEqual(claimed, 1);
          const [row] = yield* rowsOf(topic.name);
          assert.strictEqual(row?.attempts, 1);
          assert.strictEqual(row?.lastError, "failed");
          assert.isFalse(row?.dead);
        }),
    );

    it.effect("refuses a payload with no JSON form", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const transaction = yield* Transaction;
        const exit = yield* transaction
          .run(
            outbox.enqueue(Outbox.topic("test.void", Schema.Void), undefined),
          )
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }),
    );

    it.effect(
      "only claims messages of its own topic, up to the batch size",
      () =>
        Effect.gen(function* () {
          const outbox = yield* Outbox.Outbox;
          const mine = freshTopic();
          const other = freshTopic();
          yield* send(
            mine,
            { n: 1, to: "a" },
            { n: 2, to: "a" },
            { n: 3, to: "a" },
          );
          yield* send(other, { n: 9, to: "z" });
          const seen: Array<number> = [];
          const handle = ({ n }: typeof Payload.Type) =>
            Effect.sync(() => void seen.push(n));
          assert.strictEqual(
            yield* outbox.process(mine, handle, { batchSize: 2 }),
            2,
          );
          assert.deepStrictEqual(seen, [1, 2]);
          assert.strictEqual(yield* outbox.process(mine, handle), 1);
          assert.deepStrictEqual(seen, [1, 2, 3]);
          assert.strictEqual((yield* rowsOf(other.name)).length, 1);
        }),
    );
  });
});

describe("Outbox handler timeout", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("fails a handler that outlives the lease and goes on", () =>
      Effect.gen(function* () {
        const outbox = yield* Outbox.Outbox;
        const topic = freshTopic();
        yield* send(topic, { n: 1, to: "a" }, { n: 2, to: "b" });
        const options = {
          lease: Duration.minutes(1),
          backoff: () => Duration.hours(1),
        };
        const seen: Array<number> = [];

        let finished = false;
        const pass = yield* Effect.forkChild(
          outbox
            .process(
              topic,
              ({ n }) =>
                n === 1 ? Effect.never : Effect.sync(() => void seen.push(n)),
              options,
            )
            .pipe(Effect.tap(() => Effect.sync(() => void (finished = true)))),
        );
        // The pass talks to the database between the steps, in real time;
        // move the test clock past the lease until it has come that far.
        for (let i = 0; i < 200 && !finished; i++) {
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 20)));
          yield* TestClock.adjust("61 seconds");
        }
        assert.strictEqual(yield* Fiber.join(pass), 2);

        // The hanging one failed with a timeout and waits for its retry; the
        // one behind it was handled.
        assert.deepStrictEqual(seen, [2]);
        const [row] = yield* rowsOf(topic.name);
        assert.strictEqual(row?.lastError, "TimeoutError");
        assert.strictEqual(row?.attempts, 1);
      }),
    );
  });
});

describe("Outbox.consumer", () => {
  it.live("handles messages in the background until its scope ends", () =>
    Effect.gen(function* () {
      const topic = freshTopic();
      const handled = yield* Deferred.make<typeof Payload.Type>();
      yield* Layer.build(
        Outbox.consumer(
          topic,
          (payload) => Deferred.succeed(handled, payload),
          { pollInterval: "10 millis" },
        ),
      );
      yield* send(topic, { n: 7, to: "a" });
      assert.deepStrictEqual(yield* Deferred.await(handled), { n: 7, to: "a" });
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
