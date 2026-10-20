import { Authorized } from "@unhalteproblem.de/api";
import { Context, Effect, Layer } from "effect";
import * as Query from "#cqrs/Query";
import {
  type DatabaseFacts,
  type MigrationRow,
  OperationsRepository,
  type OutboxRow,
  type OutboxState,
  type TableStats,
} from "./OperationsRepository.ts";

export interface DatabaseOverview {
  readonly facts: DatabaseFacts;
  readonly tables: ReadonlyArray<TableStats>;
  readonly migrations: ReadonlyArray<MigrationRow>;
}

const make = Effect.gen(function* () {
  const repository = yield* OperationsRepository;
  return OperationsQueries.of({
    databaseOverview: Effect.gen(function* () {
      yield* Authorized("admin");
      // One after the other: they may share a connection with a caller.
      const facts = yield* repository.facts;
      const tables = yield* repository.tables;
      const migrations = yield* repository.migrations;
      return { facts, tables, migrations };
    }).pipe(
      Query.boundary,
      Effect.withSpan("OperationsQueries.databaseOverview"),
    ),

    outbox: Effect.fn("OperationsQueries.outbox")(function* (
      state: OutboxState,
      limit: number,
    ) {
      yield* Authorized("admin");
      return yield* repository.outbox(state, limit);
    }, Query.boundary),
  });
});

/**
 * How the system is doing, for admins: the database (size, connections,
 * tables, migrations) and the outbox. Catalog data and ids only, never the
 * rows' content.
 *
 * @effect-expect-leaking Authorized<"admin">
 */
export class OperationsQueries extends Context.Service<
  OperationsQueries,
  {
    readonly databaseOverview: Effect.Effect<
      DatabaseOverview,
      never,
      Authorized<"admin">
    >;
    readonly outbox: (
      state: OutboxState,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<OutboxRow>, never, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/operations/OperationsQueries") {
  /** Needs `OperationsRepository`. */
  static readonly layer = Layer.effect(OperationsQueries, make);
}
