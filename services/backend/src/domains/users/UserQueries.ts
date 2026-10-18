import { Authorized, type Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import type { Restriction, RoleChange } from "./Moderation.ts";
import { type Access, ModerationRepository } from "./ModerationRepository.ts";
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
  const moderation = yield* ModerationRepository;

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

    accessOf: Effect.fn("UserQueries.accessOf")(
      (subject: typeof Subject.Type) => moderation.accessOf(subject),
      Query.boundary,
    ),

    listUsers: Effect.fn("UserQueries.listUsers")(function* (page: {
      readonly limit: number;
      readonly offset: number;
    }) {
      yield* Authorized("admin");
      const list = yield* users.page(page);
      const total = yield* users.count;
      const ids = list.map((user) => user.id);
      const roles = yield* moderation.rolesOfUsers(ids);
      const restrictions = yield* moderation.activeRestrictionsOf(ids);
      return {
        users: list.map((user): UserOverview => ({
          user,
          roles: roles.get(user.id) ?? [],
          restriction: Option.fromUndefinedOr(restrictions.get(user.id)),
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
      const roles = yield* moderation.rolesOfUsers([id]);
      const restrictions = yield* moderation.restrictionsOf(id);
      const roleChanges = yield* moderation.roleChangesOf(id);
      return {
        user: user.value,
        roles: roles.get(id) ?? [],
        restriction: Option.fromUndefinedOr(
          restrictions.find((restriction) =>
            Option.isNone(restriction.liftedAt),
          ),
        ),
        restrictions,
        roleChanges,
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
    /**
     * The current roles (sorted) and restriction of the user with this
     * OIDC `sub`: no roles and not restricted if they have never logged in.
     * Read on every authenticated request.
     */
    readonly accessOf: (subject: typeof Subject.Type) => Effect.Effect<Access>;
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
  /** Needs `UserRepository` and `ModerationRepository`. */
  static readonly layer = Layer.effect(UserQueries, make);
}
