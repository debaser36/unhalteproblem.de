import { Context, Duration, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

/** A dependency did not answer in time, or at all. */
export class NotReady extends Schema.TaggedError<
  NotReady,
  { readonly brand: unique symbol }
>()("NotReady", { dependency: Schema.String }) {}

/** Probes dependencies for `GET /ready`. */
export class Readiness extends Context.Service<
  Readiness,
  {
    /** Succeeds when every dependency answers; the cause is logged, not returned. */
    readonly check: Effect.Effect<void, NotReady>;
  }
>()("@unhalteproblem.de/backend/Readiness") {
  /**
   * Probes with `SELECT 1`. The timeout is shorter than a typical probe
   * interval, so a stuck pool reads as "not ready" instead of hanging the probe.
   */
  static readonly layerWith = (timeout: Duration.Input) =>
    Layer.effect(
      Readiness,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return Readiness.of({
          check: sql`SELECT 1`.pipe(
            Effect.timeout(timeout),
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logWarning("Readiness check failed", cause).pipe(
                Effect.andThen(
                  Effect.fail(new NotReady({ dependency: "database" })),
                ),
              ),
            ),
            Effect.withSpan("Readiness.check"),
          ),
        });
      }),
    );

  static readonly layer = Readiness.layerWith(Duration.seconds(2));
}
