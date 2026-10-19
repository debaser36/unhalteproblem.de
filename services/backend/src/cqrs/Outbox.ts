import {
  Cause,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { requireUnitOfWork } from "./DomainEvent.ts";

/**
 * A kind of outbox message: a name and the shape of its payload. Define one
 * per side effect, next to the code that enqueues it:
 *
 * ```ts
 * export const SendContactMail = Outbox.topic(
 *   "contact.send-mail",
 *   Schema.Struct({ messageId: Schema.String }),
 * );
 * ```
 */
export interface Topic<A, I = A> {
  readonly name: string;
  readonly schema: Schema.Codec<A, I>;
}

export const topic = <A, I>(
  name: string,
  schema: Schema.Codec<A, I>,
): Topic<A, I> => ({ name, schema });

/** How a consumer claims, retries and polls. */
export interface ConsumerOptions {
  /** Messages claimed per pass. Default 10. */
  readonly batchSize?: number;
  /**
   * How long a claimed message stays reserved for its worker. A worker that
   * dies mid-message loses the reservation after this; the message is then
   * claimed again. Longer than the slowest handler. Default 5 minutes.
   */
  readonly lease?: Duration.Input;
  /** Attempts (claims) before a message is given up on. Default 10. */
  readonly maxAttempts?: number;
  /**
   * Wait before the next attempt, given the attempts made so far (1 after
   * the first). Default: 30 seconds, doubling, at most an hour.
   */
  readonly backoff?: (attempts: number) => Duration.Input;
  /** Pause between passes when the last one found nothing. Default 5 seconds. */
  readonly pollInterval?: Duration.Input;
}

const defaults = {
  batchSize: 10,
  lease: Duration.minutes(5),
  maxAttempts: 10,
  backoff: (attempts: number): Duration.Input =>
    Duration.min(
      Duration.times(Duration.seconds(30), 2 ** (attempts - 1)),
      Duration.hours(1),
    ),
  pollInterval: Duration.seconds(5),
};

const Claimed = Schema.Struct({
  id: Schema.String,
  payload: Schema.Unknown,
  attempts: Schema.Int,
});

/**
 * What a failed attempt leaves in `outbox.last_error`: the kind of failure,
 * never its text. Errors tend to quote the data they failed on (an address,
 * a message body). The full cause goes to the log.
 *
 * The one addition is a `reason` string, for the error types whose `reason`
 * is a short code by design (`MailFailed`: `EAUTH:535:AUTH PLAIN`,
 * `KeycloakAdminFailed`: `delete:403`), so that a failing handler can be
 * diagnosed from the table. An error whose `reason` could hold personal data
 * must not be used in an outbox handler.
 */
const reasonOf = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.findError(cause);
  if (
    error._tag === "Success" &&
    Predicate.hasProperty(error.success, "_tag") &&
    typeof error.success._tag === "string"
  ) {
    const reason = Predicate.hasProperty(error.success, "reason")
      ? error.success.reason
      : undefined;
    return typeof reason === "string"
      ? `${error.success._tag}:${reason.slice(0, 100)}`
      : error.success._tag;
  }
  return Cause.hasDies(cause) ? "defect" : "failed";
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: Schema.Struct({
      topic: Schema.String,
      payload: Schema.String,
      createdAt: Schema.DateTimeUtcFromDate,
    }),
    // The payload is JSON text; Postgres converts it to jsonb on insert.
    // A message is available at once: available_at starts as created_at.
    execute: ({ topic, payload, createdAt }) => sql`
      INSERT INTO outbox (topic, payload, created_at, available_at)
      VALUES (${topic}, ${payload}, ${createdAt}, ${createdAt})
    `,
  });

  // A message whose worker keeps dying (out of memory, a crash in the
  // handler) never reports a failure, so nothing else would stop it: every
  // lease expiry would hand it out again. Attempts count claims, so one that
  // has used them all is given up on here instead.
  const abandonExhausted = SqlSchema.void({
    Request: Schema.Struct({
      topic: Schema.String,
      maxAttempts: Schema.Int,
      now: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ topic, maxAttempts, now }) => sql`
      UPDATE outbox SET dead_at = ${now}, locked_until = NULL,
        last_error = 'abandoned'
      WHERE topic = ${topic} AND dead_at IS NULL AND attempts >= ${maxAttempts}
        AND (locked_until IS NULL OR locked_until < ${now})
    `,
  });

  // FOR UPDATE SKIP LOCKED: concurrent passes (several workers, or a pass
  // that outlives its lease) never take the same row. Taking a message is
  // its own statement, not part of the handler's work: a handler runs
  // outside any transaction.
  const claim = SqlSchema.findAll({
    Request: Schema.Struct({
      topic: Schema.String,
      limit: Schema.Int,
      now: Schema.DateTimeUtcFromDate,
      lockedUntil: Schema.DateTimeUtcFromDate,
    }),
    Result: Claimed,
    execute: ({ topic, limit, now, lockedUntil }) => sql`
      UPDATE outbox SET locked_until = ${lockedUntil}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox
        WHERE topic = ${topic} AND dead_at IS NULL AND available_at <= ${now}
          AND (locked_until IS NULL OR locked_until < ${now})
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id::text AS id, payload, attempts
    `,
  });

  // Everything after the claim is fenced by `attempts`: it changes with
  // every claim, so a worker whose lease ran out (and whose message someone
  // else claimed since) can no longer renew, complete or fail it. They
  // return whether the caller still held the message.

  // The lease covers one message, not the batch: a batch of slow handlers
  // would otherwise outlast it and have its tail claimed twice.
  const renew = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      attempts: Schema.Int,
      lockedUntil: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, attempts, lockedUntil }) => sql`
      UPDATE outbox SET locked_until = ${lockedUntil}
      WHERE id = ${id}::bigint AND attempts = ${attempts} AND dead_at IS NULL
      RETURNING id::text AS id
    `,
  });

  const complete = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String, attempts: Schema.Int }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, attempts }) => sql`
      DELETE FROM outbox
      WHERE id = ${id}::bigint AND attempts = ${attempts}
      RETURNING id::text AS id
    `,
  });

  const fail = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      attempts: Schema.Int,
      reason: Schema.String,
      availableAt: Schema.DateTimeUtcFromDate,
      deadAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, attempts, reason, availableAt, deadAt }) => sql`
      UPDATE outbox
      SET locked_until = NULL, last_error = ${reason},
          available_at = ${availableAt}, dead_at = ${deadAt}
      WHERE id = ${id}::bigint AND attempts = ${attempts}
      RETURNING id::text AS id
    `,
  });

  const dieOnSchema = <A, R>(
    self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError, R>,
  ) => Effect.catchTag(self, "SchemaError", Effect.die);

  const annotate = (topicName: string, message: typeof Claimed.Type) =>
    Effect.annotateLogs({
      topic: topicName,
      outboxId: message.id,
      attempts: message.attempts,
    });

  return Outbox.of({
    enqueue: Effect.fn("Outbox.enqueue")(function* <A, I>(
      topic: Topic<A, I>,
      payload: A,
    ) {
      yield* requireUnitOfWork("Enqueueing an outbox message");
      const encoded = yield* Schema.encodeEffect(topic.schema)(payload);
      const json = JSON.stringify(encoded);
      if (json === undefined) {
        return yield* Effect.die(
          new Error(`Outbox topic ${topic.name}: payload has no JSON form`),
        );
      }
      const createdAt = yield* DateTime.now;
      yield* insert({ topic: topic.name, payload: json, createdAt }).pipe(
        dieOnSchema,
      );
    }),

    process: Effect.fn("Outbox.process")(function* <A, I, E, R>(
      topic: Topic<A, I>,
      handle: (payload: A) => Effect.Effect<void, E, R>,
      options?: ConsumerOptions,
    ) {
      const { batchSize, lease, maxAttempts, backoff } = {
        ...defaults,
        ...options,
      };
      const decode = Schema.decodeUnknownEffect(topic.schema);
      const start = yield* DateTime.now;
      yield* abandonExhausted({
        topic: topic.name,
        maxAttempts,
        now: start,
      }).pipe(dieOnSchema);
      const messages = yield* claim({
        topic: topic.name,
        limit: batchSize,
        now: start,
        lockedUntil: DateTime.addDuration(start, lease),
      }).pipe(dieOnSchema);

      // One at a time and in order. A message that fails is scheduled for
      // later and the ones behind it carry on.
      for (const message of [...messages].sort((a, b) =>
        BigInt(a.id) < BigInt(b.id) ? -1 : 1,
      )) {
        const lost = annotate(
          topic.name,
          message,
        )(Effect.logWarning("Outbox message lost its lease; skipped"));
        const before = yield* DateTime.now;
        const renewed = yield* renew({
          id: message.id,
          attempts: message.attempts,
          lockedUntil: DateTime.addDuration(before, lease),
        }).pipe(dieOnSchema);
        if (Option.isNone(renewed)) {
          yield* lost;
          continue;
        }

        const decoded = yield* Effect.exit(decode(message.payload));
        if (Exit.isFailure(decoded)) {
          // It can't decode on a retry either, and the error quotes the
          // payload: give up now and log only which message it was.
          yield* annotate(
            topic.name,
            message,
          )(
            Effect.logError("Outbox message does not match its topic's schema"),
          );
          const at = yield* DateTime.now;
          const failed = yield* fail({
            id: message.id,
            attempts: message.attempts,
            reason: "InvalidPayload",
            availableAt: at,
            deadAt: at,
          }).pipe(dieOnSchema);
          if (Option.isNone(failed)) yield* lost;
          continue;
        }

        // In a child fiber, as `DomainEvent.subscriber` does: an
        // interruption raised inside the handler (joining an interrupted
        // fiber, say) must end only this attempt, not the consumer. The
        // consumer's own interruption still reaches `Fiber.await`.
        const exit = yield* Effect.forkChild(
          handle(decoded.value).pipe(
            // A handler that hangs (a DNS lookup, a dead socket) must not hold
            // the consumer, and its message, past the reservation: after the
            // lease another worker would handle the message again anyway.
            Effect.timeout(lease),
            Effect.withSpan("Outbox.handle", {
              attributes: { topic: topic.name, id: message.id },
            }),
          ),
        ).pipe(Effect.flatMap(Fiber.await));

        if (Exit.isSuccess(exit)) {
          const done = yield* complete({
            id: message.id,
            attempts: message.attempts,
          }).pipe(dieOnSchema);
          // Handled, but someone else owns the row now and will handle it
          // again: the reason handlers have to be idempotent.
          if (Option.isNone(done)) yield* lost;
          continue;
        }
        const failedAt = yield* DateTime.now;
        const dead = message.attempts >= maxAttempts;
        yield* annotate(
          topic.name,
          message,
        )(
          Effect.logError(
            dead ? "Outbox message given up on" : "Outbox message failed",
            exit.cause,
          ),
        );
        const failed = yield* fail({
          id: message.id,
          attempts: message.attempts,
          reason: reasonOf(exit.cause),
          availableAt: DateTime.addDuration(
            failedAt,
            backoff(message.attempts),
          ),
          deadAt: dead ? failedAt : null,
        }).pipe(dieOnSchema);
        if (Option.isNone(failed)) yield* lost;
      }
      return messages.length;
    }),
  });
});

/**
 * The transactional outbox: a side effect (mail, a call to another service)
 * is written as a row in the same transaction as the state change that
 * causes it, and carried out afterwards by a background consumer. The
 * change and the promise to do something about it commit together; the
 * effect itself happens at least once, however often the process dies in
 * between.
 *
 * Unlike `DomainEvents`, which are in memory and at most once, outbox
 * messages survive restarts. Handlers must therefore be idempotent: a
 * message is handled again if its worker dies before the row is deleted, or
 * if the handler fails and is retried with backoff. After `maxAttempts` a
 * message is marked dead (`outbox.dead_at`) and kept for inspection.
 */
export class Outbox extends Context.Service<
  Outbox,
  {
    /**
     * Adds a message in the current transaction. Dies outside a
     * `Transaction.run` (see `requireUnitOfWork`), like recording events.
     * Rolled back with the transaction.
     */
    readonly enqueue: <A, I>(
      topic: Topic<A, I>,
      payload: A,
    ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError>;
    /**
     * One pass of a consumer: claims up to `batchSize` due messages of the
     * topic, runs `handle` on each, deletes the ones that succeed and
     * schedules the others for a retry. Returns how many were claimed.
     * `consumer` calls this in a loop; tests call it directly.
     */
    readonly process: <A, I, E, R>(
      topic: Topic<A, I>,
      handle: (payload: A) => Effect.Effect<void, E, R>,
      options?: ConsumerOptions,
    ) => Effect.Effect<number, SqlError.SqlError, R>;
  }
>()("@unhalteproblem.de/backend/cqrs/Outbox") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(Outbox, make);
}

/**
 * A background consumer of one topic: runs `Outbox.process` until the scope
 * ends, straight away again while passes find a full batch, else after
 * `pollInterval`. A pass that fails (database briefly unreachable) is
 * logged and tried again after the pause.
 */
export const consumer = <A, I, E, R>(
  topic: Topic<A, I>,
  handle: (payload: A) => Effect.Effect<void, E, R>,
  options?: ConsumerOptions,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const outbox = yield* Outbox;
      const { batchSize, pollInterval } = { ...defaults, ...options };
      yield* outbox.process(topic, handle, options).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("Outbox pass failed", cause).pipe(Effect.as(0)),
        ),
        Effect.flatMap((claimed) =>
          claimed >= batchSize ? Effect.void : Effect.sleep(pollInterval),
        ),
        Effect.forever,
        Effect.interruptible,
        Effect.forkScoped,
      );
    }),
  );
