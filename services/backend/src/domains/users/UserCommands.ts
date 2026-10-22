import type { Subject } from "@unhalteproblem.de/oidc";
import { AccountDeletionNotAllowed } from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import { Sessions } from "#auth/Sessions";
import { DeleteKeycloakUser } from "./AccountDeletion.ts";
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
  const audit = yield* AuditCommands;
  const outbox = yield* Outbox;
  const sessions = yield* Sessions;
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
      // A deleted account stays deleted: a login that slipped in while the
      // identity provider was still removing the user must not bring the
      // profile back. The callback refuses these before it gets here.
      if (Option.isSome(existing.value.deletedAt)) return existing.value;
      const loggedIn = User.logIn(existing.value, login.profile, now);
      yield* users.update(loggedIn.user);
      yield* DomainEvent.record(...loggedIn.events);
      return loggedIn.user;
    }, Command.boundary(transaction)),

    deleteAccount: Effect.fn("UserCommands.deleteAccount")(function* (
      subject: typeof Subject.Type,
    ) {
      const now = yield* DateTime.now;
      const found = yield* users.findBySubjectForUpdate(subject);
      if (Option.isNone(found)) {
        // Every session belongs to a user who has logged in.
        return yield* Effect.die(new Error("Deleting the account of nobody"));
      }
      const user = found.value;
      if (Option.isSome(user.deletedAt)) return;
      yield* moderation.releaseUser(user.id, now);
      yield* users.update(User.anonymise(user, now));
      yield* sessions.deleteByUser(subject);
      yield* audit.record({
        action: "account_deleted",
        actor: Option.some(user.id),
        target: Option.some(user.id),
      });
      // In the same transaction, so the identity provider is told exactly
      // when the account is gone here, and again and again until it did it.
      yield* outbox.enqueue(DeleteKeycloakUser, { subject });
      yield* DomainEvent.record(new User.AccountDeleted({ userId: user.id }));
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
    /**
     * Deletes the account of the user with this OIDC `sub` (their own, from
     * their session): clears the profile, removes the roles, ends all
     * sessions and has the identity provider delete the user (outbox, with
     * retries). Records `AccountDeleted` and an audit entry. Does nothing for
     * an account already deleted. Refused for a superAdmin.
     */
    readonly deleteAccount: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<void, AccountDeletionNotAllowed>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserCommands") {
  /** Needs `UserRepository`, `ModerationCommands`, `AuditCommands`, `Outbox`, `Sessions` and `Transaction`. */
  static readonly layer = Layer.effect(UserCommands, make);
}
