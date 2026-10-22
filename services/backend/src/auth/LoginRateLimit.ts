import { Context, type Duration, Effect, Layer, Schema } from "effect";
import { RateLimiter } from "effect/persistence";
import { LoginRateLimitConfig } from "#Config";

/** The client, or all clients together, started too many logins. */
export class LoginRateLimitExceeded extends Schema.TaggedError<
  LoginRateLimitExceeded,
  { readonly brand: unique symbol }
>()("LoginRateLimitExceeded", {}) {}

interface Options {
  /** Login starts per client and window. */
  readonly limit: number;
  /** Login starts from all clients together per window. */
  readonly globalLimit: number;
  readonly window: Duration.Input;
}

const make = Effect.fn("LoginRateLimit.make")(function* (options: Options) {
  const limiter = yield* RateLimiter.RateLimiter;

  const consumeKey = (key: string, limit: number) =>
    limiter.consume({ key, limit, window: options.window }).pipe(
      Effect.asVoid,
      Effect.catchReason(
        "RateLimiterError",
        "RateLimitExceeded",
        () => Effect.fail(new LoginRateLimitExceeded()),
        // A broken store must not stop people from logging in.
        (_, error) => Effect.logWarning("Rate limiter store failed", error),
      ),
    );

  return LoginRateLimit.of({
    consume: (clientKey) =>
      consumeKey(`login:${clientKey}`, options.limit).pipe(
        Effect.andThen(consumeKey("login:global", options.globalLimit)),
      ),
  });
});

// Process-local, like the contact form's limiter (see ContactRateLimit).
const RateLimiterMemory = RateLimiter.layer.pipe(
  Layer.provide(RateLimiter.layerStoreMemory),
);

/** Limits how often logins may be started. */
export class LoginRateLimit extends Context.Service<
  LoginRateLimit,
  {
    readonly consume: (
      clientKey: string,
    ) => Effect.Effect<void, LoginRateLimitExceeded>;
  }
>()("@unhalteproblem.de/backend/LoginRateLimit") {
  /** The limits from `LOGIN_RATE_LIMIT*` (see `LoginRateLimitConfig`). */
  static readonly layer = Layer.effect(
    LoginRateLimit,
    Effect.gen(function* () {
      return yield* make(yield* LoginRateLimitConfig);
    }),
  ).pipe(Layer.provide(RateLimiterMemory));

  /** Fixed limits with a fresh in-memory store, for tests. */
  static readonly layerWith = (options: Options) =>
    Layer.effect(LoginRateLimit, make(options)).pipe(
      Layer.provide(RateLimiterMemory),
    );
}
