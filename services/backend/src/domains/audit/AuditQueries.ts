import { Authorized } from "@unhalteproblem.de/api";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import type { UserId } from "#domains/users/User";
import type { AuditAction, AuditRecord } from "./Audit.ts";
import { AuditRepository } from "./AuditRepository.ts";

export interface AuditPage {
  readonly entries: ReadonlyArray<AuditRecord>;
  /** The id the next page starts before; none on the last page. */
  readonly next: Option.Option<number>;
}

const make = Effect.gen(function* () {
  const repository = yield* AuditRepository;
  return AuditQueries.of({
    page: Effect.fn("AuditQueries.page")(function* (query: {
      readonly limit: number;
      readonly before: Option.Option<number>;
      readonly action: Option.Option<AuditAction>;
      readonly userId: Option.Option<UserId>;
    }) {
      yield* Authorized("admin");
      // One more than asked tells whether there is a next page.
      const rows = yield* repository.page({ ...query, limit: query.limit + 1 });
      const entries = rows.slice(0, query.limit);
      const last = entries.at(-1);
      return {
        entries,
        next:
          rows.length > query.limit && last !== undefined
            ? Option.some(last.id)
            : Option.none(),
      } satisfies AuditPage;
    }, Query.boundary),
  });
});

/**
 * Reading the audit log, for admins.
 *
 * @effect-expect-leaking Authorized<"admin">
 */
export class AuditQueries extends Context.Service<
  AuditQueries,
  {
    /** Entries newest first, optionally of one action or of one user (as actor or target). */
    readonly page: (query: {
      readonly limit: number;
      readonly before: Option.Option<number>;
      readonly action: Option.Option<AuditAction>;
      readonly userId: Option.Option<UserId>;
    }) => Effect.Effect<AuditPage, never, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/audit/AuditQueries") {
  /** Needs `AuditRepository`. */
  static readonly layer = Layer.effect(AuditQueries, make);
}
