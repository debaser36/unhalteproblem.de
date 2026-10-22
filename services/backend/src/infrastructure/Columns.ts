import { Document } from "@unhalteproblem.de/api";
import { Schema } from "effect";
import { Model } from "effect/schema";
import { SqlError } from "effect/sql";

/**
 * A `jsonb` column holding a rich `Document` (posts, projects). jsonb comes
 * back parsed; it's written as JSON text, which Postgres converts to jsonb
 * (as in `Session.claims`).
 */
export const DocumentColumn = Model.Field({
  select: Document,
  insert: Schema.fromJsonString(Document),
  update: Schema.fromJsonString(Document),
  json: Document,
});

/**
 * Whether `error` is a violation of the unique constraint `constraint`,
 * e.g. a slug someone else took. Only catch it around a savepoint (a nested
 * `Transaction.run`): the failed statement has aborted it.
 */
export const isUniqueViolation =
  (constraint: string) =>
  (error: unknown): boolean =>
    SqlError.isSqlError(error) &&
    error.reason._tag === "UniqueViolation" &&
    error.reason.constraint === constraint;
