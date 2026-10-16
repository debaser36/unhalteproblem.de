import { Context, type Duration, Effect, Layer, Schema } from "effect";
import { RateLimiter } from "effect/persistence";
import { ContactRateLimitConfig } from "#Config";

/** The client, or the form as a whole, has used up the current window. */
export class ContactRateLimitExceeded extends Schema.TaggedError<
  ContactRateLimitExceeded,
  { readonly brand: unique symbol }
>()("ContactRateLimitExceeded", {}) {}

interface Options {
  /** Messages per client and window. */
  readonly limit: number;
  /** Messages from all clients together per window. */
  readonly globalLimit: number;
  readonly window: Duration.Input;
}

const make = Effect.fn("ContactRateLimit.make")(function* (options: Options) {
  const limiter = yield* RateLimiter.RateLimiter;

  const consumeKey = (key: string, limit: number) =>
    limiter.consume({ key, limit, window: options.window }).pipe(
      Effect.asVoid,
      Effect.catchReason(
        "RateLimiterError",
        "RateLimitExceeded",
        () => Effect.fail(new ContactRateLimitExceeded()),
        // A broken store must not take the contact form down with it.
        (_, error) => Effect.logWarning("Rate limiter store failed", error),
      ),
    );

  return ContactRateLimit.of({
    // The client's own limit first, so rejected attempts don't use up the
    // global budget.
    consume: (clientKey) =>
      consumeKey(`contact:${clientKey}`, options.limit).pipe(
        Effect.andThen(consumeKey("contact:global", options.globalLimit)),
      ),
  });
});

// Process-local and reset on restart. Good enough for a single container; a
// shared store (RateLimiter.layerStoreRedis) is needed once there are more.
// Its map keeps one entry per key until restart, which the IPv6 /64 keys
// (see clientKey), nginx's limit_req and the container memory limit bound.
const RateLimiterMemory = RateLimiter.layer.pipe(
  Layer.provide(RateLimiter.layerStoreMemory),
);

/** Limits how often the contact form may be submitted. */
export class ContactRateLimit extends Context.Service<
  ContactRateLimit,
  {
    readonly consume: (
      clientKey: string,
    ) => Effect.Effect<void, ContactRateLimitExceeded>;
  }
>()("@unhalteproblem.de/backend/ContactRateLimit") {
  /** Limits from the environment (`CONTACT_RATE_LIMIT*`), in-memory store. */
  static readonly layer = Layer.effect(
    ContactRateLimit,
    Effect.gen(function* () {
      return yield* make(yield* ContactRateLimitConfig);
    }),
  ).pipe(Layer.provide(RateLimiterMemory));

  /** Fixed limits with a fresh in-memory store, for tests. */
  static readonly layerWith = (options: Options) =>
    Layer.effect(ContactRateLimit, make(options)).pipe(
      Layer.provide(RateLimiterMemory),
    );
}
