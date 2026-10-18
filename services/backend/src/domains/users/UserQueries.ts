import type { Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import { type User, UserNotFound, type UserId } from "./User.ts";
import { UserRepository } from "./UserRepository.ts";

const make = Effect.gen(function* () {
  const users = yield* UserRepository;

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

    rolesOf: Effect.fn("UserQueries.rolesOf")(
      (subject: typeof Subject.Type) => users.rolesOf(subject),
      Query.boundary,
    ),
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
     * The current roles of the user with this OIDC `sub`, sorted; empty if
     * they have never logged in.
     */
    readonly rolesOf: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<ReadonlyArray<Role>>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserQueries") {
  /** Needs `UserRepository`. */
  static readonly layer = Layer.effect(UserQueries, make);
}
