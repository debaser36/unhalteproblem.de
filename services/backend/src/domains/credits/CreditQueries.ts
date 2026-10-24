import type { CreditBalance } from "@unhalteproblem.de/api";
import { Context, Effect, Layer } from "effect";
import * as Query from "#cqrs/Query";
import type { UserId } from "#domains/users/User";
import { CreditRepository } from "./CreditRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* CreditRepository;

  return CreditQueries.of({
    balancesOf: (userId) =>
      repository
        .balancesOf(userId)
        .pipe(Query.boundary, Effect.withSpan("CreditQueries.balancesOf")),
    holders: repository.holders.pipe(
      Query.boundary,
      Effect.withSpan("CreditQueries.holders"),
    ),
  });
});

/** The reads of credits. */
export class CreditQueries extends Context.Service<
  CreditQueries,
  {
    /**
     * Per feature the user ever got credits of (and kept: revoked ones
     * don't count), how many are available and how many were used.
     */
    readonly balancesOf: (
      userId: UserId,
    ) => Effect.Effect<ReadonlyArray<CreditBalance>>;
    /** The users holding credits that were not revoked. */
    readonly holders: Effect.Effect<ReadonlyArray<UserId>>;
  }
>()("@unhalteproblem.de/backend/domains/credits/CreditQueries") {
  /** Needs `CreditRepository`. */
  static readonly layer = Layer.effect(CreditQueries, make);
}
