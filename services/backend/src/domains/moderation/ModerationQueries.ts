import { Authorized, type Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import type { UserId } from "#domains/users/User";
import type { Restriction, RoleChange } from "./Moderation.ts";
import { type Access, ModerationRepository } from "./ModerationRepository.ts";

/** What admins see of a user's standing in the list. */
export interface Standing {
  readonly roles: ReadonlyArray<Role>;
  /** The active restriction, if any. */
  readonly restriction: Option.Option<Restriction>;
}

/** Everything that happened to a user's roles and restrictions. */
export interface History {
  /** Every restriction, newest first. */
  readonly restrictions: ReadonlyArray<Restriction>;
  /** The role change log, oldest first. */
  readonly roleChanges: ReadonlyArray<RoleChange>;
}

const make = Effect.gen(function* () {
  const moderation = yield* ModerationRepository;

  return ModerationQueries.of({
    accessOf: Effect.fn("ModerationQueries.accessOf")(
      (subject: typeof Subject.Type) => moderation.accessOf(subject),
      Query.boundary,
    ),

    standingOf: Effect.fn("ModerationQueries.standingOf")(function* (
      ids: ReadonlyArray<UserId>,
    ) {
      yield* Authorized("admin");
      const roles = yield* moderation.rolesOfUsers(ids);
      const restrictions = yield* moderation.activeRestrictionsOf(ids);
      return new Map(
        ids.map((id): [UserId, Standing] => [
          id,
          {
            roles: roles.get(id) ?? [],
            restriction: Option.fromUndefinedOr(restrictions.get(id)),
          },
        ]),
      );
    }, Query.boundary),

    historyOf: Effect.fn("ModerationQueries.historyOf")(function* (id: UserId) {
      yield* Authorized("admin");
      return {
        restrictions: yield* moderation.restrictionsOf(id),
        roleChanges: yield* moderation.roleChangesOf(id),
      } satisfies History;
    }, Query.boundary),
  });
});

/** The queries of the moderation domain: reads that change nothing. */
export class ModerationQueries extends Context.Service<
  ModerationQueries,
  {
    /**
     * Roles and restriction of the user with this OIDC `sub`, in one query;
     * no roles and not restricted for an unknown subject. For the login
     * check; requests that already have a session read it with the session
     * (`#auth/SessionAccess`).
     */
    readonly accessOf: (subject: typeof Subject.Type) => Effect.Effect<Access>;
    /** The roles and active restriction of each of these users (admins only). */
    readonly standingOf: (
      ids: ReadonlyArray<UserId>,
    ) => Effect.Effect<
      ReadonlyMap<UserId, Standing>,
      never,
      Authorized<"admin">
    >;
    /** One user's restrictions and role changes (admins only). */
    readonly historyOf: (
      id: UserId,
    ) => Effect.Effect<History, never, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/moderation/ModerationQueries") {
  /** Needs `ModerationRepository`. */
  static readonly layer = Layer.effect(ModerationQueries, make);
}
