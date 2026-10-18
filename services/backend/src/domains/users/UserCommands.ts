import {
  AlreadyRestricted,
  Authorized,
  Forbidden,
  NotRestricted,
  RestrictionNotAllowed,
  type Role,
  RoleChangeNotAllowed,
} from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { Sessions } from "#repositories/Sessions";
import {
  type Party,
  Restriction,
  RestrictionId,
  RestrictionLifted,
  restrictionRefusal,
  revocationRefusal,
  RoleGranted,
  RoleRevoked,
  UserRestricted,
} from "./Moderation.ts";
import { ModerationRepository } from "./ModerationRepository.ts";
import * as User from "./User.ts";
import { UserRepository } from "./UserRepository.ts";

/** A successful login, as verified from the ID token. */
export interface Login {
  readonly subject: typeof Subject.Type;
  readonly profile: User.UserProfile;
}

const make = Effect.gen(function* () {
  const users = yield* UserRepository;
  const moderation = yield* ModerationRepository;
  const sessions = yield* Sessions;
  const transaction = yield* Transaction;

  const newId = Effect.sync(() => crypto.randomUUID());

  /**
   * The two sides of a moderation command, both locked until the
   * transaction ends (in id order, so concurrent commands can't deadlock)
   * and read under that lock.
   *
   * The proof only says what the actor held when their request started. If
   * they lost `required` or were restricted since (say, by a moderator
   * acting on them at the same moment), they are refused with `Forbidden`
   * here, so two superAdmins restricting each other can't both succeed.
   */
  const lockParties = Effect.fnUntraced(function* (
    proof: { readonly user: { readonly id: string } },
    targetId: User.UserId,
    required: Role,
  ) {
    const actorUser = yield* users.findBySubject(proof.user.id);
    if (Option.isNone(actorUser)) {
      // Every session belongs to a user who has logged in since 0002.
      return yield* Effect.die(new Error("Moderator without a user"));
    }
    const actorId = actorUser.value.id;
    const locked = yield* users.lockForUpdate([actorId, targetId]);
    const target = locked.find((user) => user.id === targetId);
    if (target === undefined) {
      return yield* new User.UserNotFound({ userId: targetId });
    }
    const roles = yield* moderation.rolesOfUsers([actorId, targetId]);
    const actor: Party = { id: actorId, roles: roles.get(actorId) ?? [] };
    const restricted = yield* moderation.activeRestrictionsOf([actorId]);
    if (!actor.roles.includes(required) || restricted.has(actorId)) {
      return yield* new Forbidden();
    }
    return { actor, target, targetRoles: roles.get(targetId) ?? [] };
  });

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
          for (const role of registered.roles) {
            const change = {
              userId: registered.user.id,
              role,
              by: Option.none(),
              at: now,
            };
            yield* moderation.grantRole(change);
            yield* moderation.recordRoleChange({
              ...change,
              change: "granted",
            });
          }
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

    grantRole: Effect.fn("UserCommands.grantRole")(function* (
      userId: User.UserId,
      role: Role,
    ) {
      const { actor } = yield* lockParties(
        yield* Authorized("superAdmin"),
        userId,
        "superAdmin",
      );
      const now = yield* DateTime.now;
      const change = { userId, role, by: Option.some(actor.id), at: now };
      if (yield* moderation.grantRole(change)) {
        yield* moderation.recordRoleChange({ ...change, change: "granted" });
        yield* DomainEvent.record(
          new RoleGranted({ userId, role, by: actor.id }),
        );
      }
    }, Command.boundary(transaction)),

    revokeRole: Effect.fn("UserCommands.revokeRole")(function* (
      userId: User.UserId,
      role: Role,
    ) {
      const proof = yield* Authorized("superAdmin");
      // Locked before the users, in the same order everywhere, so two
      // revocations can't both see a second superAdmin.
      const superAdmins = yield* moderation.lockSuperAdmins;
      const { actor, targetRoles } = yield* lockParties(
        proof,
        userId,
        "superAdmin",
      );
      if (!targetRoles.includes(role)) return;
      const refusal = revocationRefusal({
        actor: actor.id,
        target: userId,
        role,
        superAdmins: superAdmins.length,
      });
      if (Option.isSome(refusal)) {
        return yield* new RoleChangeNotAllowed({ reason: refusal.value });
      }
      const now = yield* DateTime.now;
      yield* moderation.revokeRole(userId, role);
      yield* moderation.recordRoleChange({
        userId,
        role,
        change: "revoked",
        by: Option.some(actor.id),
        at: now,
      });
      yield* DomainEvent.record(
        new RoleRevoked({ userId, role, by: actor.id }),
      );
    }, Command.boundary(transaction)),

    restrict: Effect.fn("UserCommands.restrict")(function* (
      userId: User.UserId,
      note: string,
    ) {
      const { actor, target, targetRoles } = yield* lockParties(
        yield* Authorized("admin"),
        userId,
        "admin",
      );
      const refusal = restrictionRefusal(actor, {
        id: userId,
        roles: targetRoles,
      });
      if (Option.isSome(refusal)) {
        return yield* new RestrictionNotAllowed({ reason: refusal.value });
      }
      const restriction = new Restriction({
        id: RestrictionId.make(yield* newId),
        userId,
        note,
        restrictedBy: Option.some(actor.id),
        restrictedAt: yield* DateTime.now,
        liftedAt: Option.none(),
        liftedBy: Option.none(),
        liftNote: Option.none(),
      });
      if (!(yield* moderation.insertActiveRestriction(restriction))) {
        return yield* new AlreadyRestricted({ userId });
      }
      // Logged out everywhere at once; the per-request check refuses the
      // sessions anyway, this just removes them.
      yield* sessions.deleteByUser(target.subject);
      yield* DomainEvent.record(
        new UserRestricted({
          userId,
          restrictionId: restriction.id,
          by: actor.id,
        }),
      );
      return restriction;
    }, Command.boundary(transaction)),

    liftRestriction: Effect.fn("UserCommands.liftRestriction")(function* (
      userId: User.UserId,
      note: Option.Option<string>,
    ) {
      const { actor, target, targetRoles } = yield* lockParties(
        yield* Authorized("admin"),
        userId,
        "admin",
      );
      const refusal = restrictionRefusal(actor, {
        id: userId,
        roles: targetRoles,
      });
      if (Option.isSome(refusal)) {
        return yield* new RestrictionNotAllowed({ reason: refusal.value });
      }
      const active = yield* moderation.findActiveRestrictionForUpdate(userId);
      if (Option.isNone(active)) {
        return yield* new NotRestricted({ userId });
      }
      const now = yield* DateTime.now;
      const lifted = new Restriction({
        ...active.value,
        liftedAt: Option.some(now),
        liftedBy: Option.some(actor.id),
        liftNote: note,
      });
      yield* moderation.liftRestriction({
        id: lifted.id,
        at: now,
        by: actor.id,
        note,
      });
      // A session created while the restriction was being made (a login
      // racing it) survived its deleteByUser; it must not come back to life.
      yield* sessions.deleteByUser(target.subject);
      yield* DomainEvent.record(
        new RestrictionLifted({
          userId,
          restrictionId: lifted.id,
          by: actor.id,
        }),
      );
      return lifted;
    }, Command.boundary(transaction)),
  });
});

/** The commands of the users domain: everything that changes a `User`. */
export class UserCommands extends Context.Service<
  UserCommands,
  {
    /**
     * Creates the user on their first login, with the initial roles
     * (`normalUser`, recorded in the role change log), and refreshes their
     * profile and last login time on every later one. Records
     * `UserRegistered` or, if the profile changed, `UserProfileChanged`.
     */
    readonly syncFromLogin: (login: Login) => Effect.Effect<User.User>;
    /**
     * Grants a role (superAdmins only). Granting a held role changes
     * nothing; otherwise it is logged and `RoleGranted` recorded.
     */
    readonly grantRole: (
      userId: User.UserId,
      role: Role,
    ) => Effect.Effect<
      void,
      User.UserNotFound | Forbidden,
      Authorized<"superAdmin">
    >;
    /**
     * Revokes a role (superAdmins only). Revoking a role the user doesn't
     * hold changes nothing. Nobody revokes their own superAdmin, and the
     * last superAdmin keeps it.
     */
    readonly revokeRole: (
      userId: User.UserId,
      role: Role,
    ) => Effect.Effect<
      void,
      User.UserNotFound | RoleChangeNotAllowed | Forbidden,
      Authorized<"superAdmin">
    >;
    /**
     * Restricts an account (admins only): it is blocked until lifted, and
     * its sessions end now. Nobody restricts themselves, and only a
     * superAdmin restricts an admin or superAdmin.
     */
    readonly restrict: (
      userId: User.UserId,
      note: string,
    ) => Effect.Effect<
      Restriction,
      User.UserNotFound | AlreadyRestricted | RestrictionNotAllowed | Forbidden,
      Authorized<"admin">
    >;
    /**
     * Lifts the active restriction (admins only), under the same rules,
     * and ends the user's sessions once more: they log in anew.
     */
    readonly liftRestriction: (
      userId: User.UserId,
      note: Option.Option<string>,
    ) => Effect.Effect<
      Restriction,
      User.UserNotFound | NotRestricted | RestrictionNotAllowed | Forbidden,
      Authorized<"admin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/users/UserCommands") {
  /** Needs `UserRepository`, `ModerationRepository`, `Sessions` and `Transaction`. */
  static readonly layer = Layer.effect(UserCommands, make);
}
