import { Authorized, type Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import type { Restriction, RoleChange } from "#domains/moderation/Moderation";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { type User, UserNotFound, type UserId } from "./User.ts";
import { UserRepository } from "./UserRepository.ts";

/** A user as admins see them in the list. */
export interface UserOverview {
  readonly user: User;
  readonly roles: ReadonlyArray<Role>;
  /** The active restriction, if any. */
  readonly restriction: Option.Option<Restriction>;
}

/** A user as admins see them on their own page. */
export interface UserDetails extends UserOverview {
  /** Every restriction, newest first. */
  readonly restrictions: ReadonlyArray<Restriction>;
  /** The role change log, oldest first. */
  readonly roleChanges: ReadonlyArray<RoleChange>;
}

const make = Effect.gen(function* () {
  const users = yield* UserRepository;
  const moderation = yield* ModerationQueries;

  return UserQueries.of({
    getById: Effect.fn("UserQueries.getById")(function* (id: UserId) {
      const user = yield* users.findById(id);
      if (Option.isNone(user)) {
        return yield* new UserNotFound({ userId: id });
      }
      return user.value;
    }, Query.boundary),

    findBySubject: Effect.fn("UserQueries.findBySubject")(
      (subject: typeof Subject.Type) => users.findBySubject(subject),
      Query.boundary,
    ),

    listUsers: Effect.fn("UserQueries.listUsers")(function* (page: {
      readonly limit: number;
      readonly offset: number;
    }) {
      yield* Authorized("admin");
      const list = yield* users.page(page);
      const total = yield* users.count;
      const standing = yield* moderation.standingOf(list.map((u) => u.id));
      return {
        users: list.map((user): UserOverview => ({
          user,
          roles: standing.get(user.id)?.roles ?? [],
          restriction: standing.get(user.id)?.restriction ?? Option.none(),
        })),
        total,
      };
    }, Query.boundary),

    getDetails: Effect.fn("UserQueries.getDetails")(function* (id: UserId) {
      yield* Authorized("admin");
      const user = yield* users.findById(id);
      if (Option.isNone(user)) {
        return yield* new UserNotFound({ userId: id });
      }
      const standing = (yield* moderation.standingOf([id])).get(id);
      const history = yield* moderation.historyOf(id);
      return {
        user: user.value,
        roles: standing?.roles ?? [],
        restriction: standing?.restriction ?? Option.none(),
        ...history,
      } satisfies UserDetails;
    }, Query.boundary),
  });
});

/** The queries of the users domain: reads that change nothing. */
export class UserQueries extends Context.Service<
  UserQueries,
  {
    readonly getById: (id: UserId) => Effect.Effect<User, UserNotFound>;
    /** The user with this OIDC `sub`, if they have ever logged in. */
    readonly findBySubject: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<Option.Option<User>>;
    /** A page of all users, oldest first (admins only). */
    readonly listUsers: (page: {
      readonly limit: number;
      readonly offset: number;
    }) => Effect.Effect<
      { readonly users: ReadonlyArray<UserOverview>; readonly total: number },
      never,
      Authorized<"admin">
    >;
    /** Everything about one user (admins only). */
    readonly getDetails: (
      id: UserId,
    ) => Effect.Effect<UserDetails, UserNotFound, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserQueries") {
  /** Needs `UserRepository` and `ModerationQueries`. */
  static readonly layer = Layer.effect(UserQueries, make);
}
