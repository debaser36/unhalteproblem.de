import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { Effect, Schema } from "effect";

/**
 * The id of an outbox message: a positive safe integer, increasing with
 * each message (the `bigint` identity of `outbox`, which the backend
 * converts from the string Postgres returns).
 */
export const OutboxMessageId = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
)
  .pipe(Schema.brand("OutboxMessageId"))
  .annotate({
    identifier: "OutboxMessageId",
    description:
      "The id of an outbox message, a positive integer that increases with " +
      "each message.",
  });
export type OutboxMessageId = typeof OutboxMessageId.Type;

/**
 * Which outbox messages `GET /admin/outbox` lists: `pending` ones still
 * waiting for (or in) an attempt (`deadAt` is null), `dead` ones that ran out
 * of attempts and are never claimed again, or `all`.
 */
export const OutboxState = Schema.Literals(["pending", "dead", "all"]).annotate(
  {
    identifier: "OutboxState",
    description:
      "`pending`: not dead yet (waiting or in an attempt); `dead`: out of " +
      "attempts, never claimed again; `all`: both.",
  },
);
export type OutboxState = typeof OutboxState.Type;

/**
 * An outbox message, as admins see it: its state, without the payload. A
 * handled message is deleted, so every listed message is pending or dead.
 */
export const OutboxMessage = Schema.Struct({
  id: OutboxMessageId,
  /** The handler the message is for, e.g. `contact.send-mail`. */
  topic: Schema.String,
  /** Attempts (claims) made so far. */
  attempts: Schema.Natural,
  /**
   * The kind of failure of the last failed attempt (never its text, which
   * could hold personal data); `null` if no attempt has failed yet.
   */
  lastError: Schema.NullOr(Schema.String),
  /** When the message may be claimed next (backoff after a failure). */
  availableAt: IsoDateTimeUtc,
  /**
   * Until when a worker holds the message; `null` if none ever claimed it
   * or the lease was cleared. A past value is an expired lease.
   */
  lockedUntil: Schema.NullOr(IsoDateTimeUtc),
  /** When the message ran out of attempts; `null` while it is pending. */
  deadAt: Schema.NullOr(IsoDateTimeUtc),
  createdAt: IsoDateTimeUtc,
}).annotate({
  identifier: "OutboxMessage",
  description:
    "A pending or dead outbox message, without its payload. `deadAt` is " +
    "null while it is pending.",
});
export type OutboxMessage = typeof OutboxMessage.Type;

/** Limits of `GET /admin/outbox`. */
export const OutboxLimits = {
  /** Number of messages when `limit` is absent. */
  defaultLimit: 100,
  /** Largest `limit` accepted. */
  maxLimit: 200,
} as const;

/**
 * Query of `GET /admin/outbox`. Decoding fills in the defaults (`state`
 * `all`, `limit` 100); in the generated client both are therefore
 * required.
 */
export const OutboxQuery = Schema.Struct({
  /** Which messages; `all` by default. */
  state: OutboxState.annotateKey({
    description: "`pending`, `dead` or `all`; `all` if absent.",
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed("all" as const))),
  /** How many messages at most, 1 to 200; 100 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: OutboxLimits.maxLimit }),
  )
    // Described on the key, before the default (see `UserPageQuery`).
    .annotateKey({
      description:
        "How many messages at most, an integer from 1 to 200; 100 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(OutboxLimits.defaultLimit)),
    ),
}).annotate({ identifier: "OutboxQuery" });
export type OutboxQuery = typeof OutboxQuery.Type;
