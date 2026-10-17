import { Effect, Schema } from "effect";
import { SqlError } from "effect/sql";

/**
 * Failures of the storage underneath a domain, not of the domain itself: an
 * unreachable database, or a row that doesn't decode. Callers can't do
 * anything sensible about them, so command and query boundaries turn them
 * into defects (logged, HTTP 500).
 */
export type InfrastructureError = SqlError.SqlError | Schema.SchemaError;

const isInfrastructureError = <E>(
  error: E,
): error is Extract<E, InfrastructureError> =>
  SqlError.isSqlError(error) || Schema.isSchemaError(error);

/**
 * The boundary of a query: a read that changes nothing and records no
 * events. It runs without a transaction of its own (or inside the caller's,
 * if there is one) and fails only with domain errors, such as
 * `UserNotFound`.
 *
 * Pass it as the last argument of `Effect.fn`, so the span covers it:
 *
 * ```ts
 * findById: Effect.fn("UserQueries.findById")(function* (id: UserId) {
 *   // ...
 * }, Query.boundary),
 * ```
 */
export const boundary = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, InfrastructureError>, R> =>
  // `Exclude<E, Extract<E, X>>` is `Exclude<E, X>` for every concrete `E`,
  // but TypeScript can't show it for a generic one.
  Effect.catchIf(self, isInfrastructureError, Effect.die) as Effect.Effect<
    A,
    Exclude<E, InfrastructureError>,
    R
  >;
