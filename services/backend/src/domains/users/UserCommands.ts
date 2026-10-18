import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import * as User from "./User.ts";
import { UserRepository } from "./UserRepository.ts";

/** A successful login, as verified from the ID token. */
export interface Login {
  readonly subject: typeof Subject.Type;
  readonly profile: User.UserProfile;
}

const make = Effect.gen(function* () {
  const users = yield* UserRepository;
  const moderation = yield* ModerationCommands;
  const transaction = yield* Transaction;

  const newId = Effect.sync(() => crypto.randomUUID());

  return UserCommands.of({
    syncFromLogin: Effect.fn("UserCommands.syncFromLogin")(function* (
      login: Login,
    ) {
      const now = yield* DateTime.now;
      let existing = yield* users.findBySubjectForUpdate(login.subject);
      if (Option.isNone(existing)) {
        const registered = User.register({
          id: User.UserId.make(yield* newId),
          subject: login.subject,
          profile: login.profile,
          now,
        });
        if (yield* users.insertIfAbsent(registered.user)) {
          // In this transaction (a savepoint), so the user never exists
          // without their roles.
          yield* moderation.grantInitialRoles(registered.user.id, now);
          yield* DomainEvent.record(...registered.events);
          return registered.user;
        }
        // A concurrent first login of the same user was faster and has
        // committed; continue as a repeated login of the user it created.
        existing = yield* users.findBySubjectForUpdate(login.subject);
      }
      if (Option.isNone(existing)) {
        return yield* Effect.die(
          new Error("User missing after a conflicting insert"),
        );
      }
      const loggedIn = User.logIn(existing.value, login.profile, now);
      yield* users.update(loggedIn.user);
      yield* DomainEvent.record(...loggedIn.events);
      return loggedIn.user;
    }, Command.boundary(transaction)),
  });
});

/** The commands of the users domain: everything that changes a `User`. */
export class UserCommands extends Context.Service<
  UserCommands,
  {
    /**
     * Creates the user on their first login, with the initial roles
     * (`normalUser`, recorded in the role change log by moderation), and
     * refreshes their profile and last login time on every later one.
     * Records `UserRegistered` or, if the profile changed,
     * `UserProfileChanged`.
     */
    readonly syncFromLogin: (login: Login) => Effect.Effect<User.User>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserCommands") {
  /** Needs `UserRepository`, `ModerationCommands` and `Transaction`. */
  static readonly layer = Layer.effect(UserCommands, make);
}
