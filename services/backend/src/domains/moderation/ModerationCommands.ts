import {
  AccountDeletionNotAllowed,
  AlreadyRestricted,
  Authorized,
  blogEditorRole,
  BlogNotFound,
  blogOfEditorRole,
  type BlogSlug,
  Forbidden,
  NotRestricted,
  type PurchasableRole,
  RestrictionNotAllowed,
  type Role,
  RoleChangeNotAllowed,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { BlogDirectory } from "#domains/blogs/BlogDirectory";
import type { CreditRole } from "#domains/credits/Credit";
import { UserDirectory } from "#domains/users/UserDirectory";
import { initialRoles, type UserId, UserNotFound } from "#domains/users/User";
import { Sessions } from "#auth/Sessions";
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

const make = Effect.gen(function* () {
  const users = yield* UserDirectory;
  const moderation = yield* ModerationRepository;
  const sessions = yield* Sessions;
  const audit = yield* AuditCommands;
  const blogs = yield* BlogDirectory;
  const transaction = yield* Transaction;

  const newId = Effect.sync(() => crypto.randomUUID());

  /**
   * The two sides of a moderation command, both locked until the
   * transaction ends (in id order, so concurrent commands can't deadlock)
   * and read under that lock.
   *
   * The proof only says what the actor held when their request started. If
   * they lost every role of `required` or were restricted since (say, by a moderator
   * acting on them at the same moment), they are refused with `Forbidden`
   * here, so two superAdmins restricting each other can't both succeed.
   */
  const lockParties = Effect.fnUntraced(function* (
    proof: { readonly user: { readonly id: string } },
    targetId: UserId,
    required: ReadonlyArray<Role>,
  ) {
    const actorUser = yield* users.findBySubject(proof.user.id);
    if (Option.isNone(actorUser)) {
      // Every session belongs to a user who has logged in since 0002.
      return yield* Effect.die(new Error("Moderator without a user"));
    }
    const actorId = actorUser.value.id;
    const locked = yield* users.lockForUpdate([actorId, targetId]);
    const target = locked.find((user) => user.id === targetId);
    // A user who deleted their account is gone as far as moderators are
    // concerned: nothing may grant them roles or restrict them.
    if (target === undefined || Option.isSome(target.deletedAt)) {
      return yield* new UserNotFound({ userId: targetId });
    }
    const roles = yield* moderation.rolesOfUsers([actorId, targetId]);
    const actor: Party = { id: actorId, roles: roles.get(actorId) ?? [] };
    const restricted = yield* moderation.activeRestrictionsOf([actorId]);
    const permitted = required.some((role) => actor.roles.includes(role));
    if (!permitted || restricted.has(actorId)) {
      return yield* new Forbidden();
    }
    return { actor, target, targetRoles: roles.get(targetId) ?? [] };
  });

  return ModerationCommands.of({
    grantInitialRoles: Effect.fn("ModerationCommands.grantInitialRoles")(
      function* (userId: UserId, now: DateTime.Utc) {
        for (const role of initialRoles) {
          const change = { userId, role, by: Option.none(), at: now };
          yield* moderation.grantRole(change);
          yield* moderation.recordRoleChange({ ...change, change: "granted" });
        }
      },
      Command.boundary(transaction),
    ),

    releaseUser: Effect.fn("ModerationCommands.releaseUser")(function* (
      userId: UserId,
      at: DateTime.Utc,
    ) {
      const roles =
        (yield* moderation.rolesOfUsers([userId])).get(userId) ?? [];
      // The last superAdmin can't go: the site must keep one. Not even by
      // leaving; they ask another superAdmin to revoke the role first.
      if (roles.includes("superAdmin")) {
        return yield* new AccountDeletionNotAllowed({ reason: "superAdmin" });
      }
      for (const role of roles) {
        yield* moderation.revokeRole(userId, role);
        yield* moderation.recordRoleChange({
          userId,
          role,
          change: "revoked",
          by: Option.none(),
          at,
        });
      }
    }, Command.boundary(transaction)),

    syncPaidRoles: Effect.fn("ModerationCommands.syncPaidRoles")(function* (
      userId: UserId,
      entitled: ReadonlyArray<PurchasableRole | CreditRole>,
    ) {
      const [user] = yield* users.lockForUpdate([userId]);
      // A deleted account keeps nothing, whatever Stripe still says.
      const keep: ReadonlyArray<Role> =
        user === undefined || Option.isSome(user.deletedAt) ? [] : entitled;
      const now = yield* DateTime.now;
      const change = { userId, by: Option.none(), at: now };
      for (const role of keep) {
        if (yield* moderation.grantPaidRole({ userId, role, at: now })) {
          yield* moderation.recordRoleChange({
            ...change,
            role,
            change: "granted",
          });
        }
      }
      for (const role of yield* moderation.paidRolesOf(userId)) {
        if (keep.includes(role)) continue;
        if (yield* moderation.revokePaidRole(userId, role)) {
          yield* moderation.recordRoleChange({
            ...change,
            role,
            change: "revoked",
          });
        }
      }
    }, Command.boundary(transaction)),

    grantRole: Effect.fn("ModerationCommands.grantRole")(function* (
      userId: UserId,
      role: Role,
    ) {
      const { actor } = yield* lockParties(
        yield* Authorized("superAdmin"),
        userId,
        ["superAdmin"],
      );
      // An editor role only for a subblog that exists: one for a subblog
      // created later would start to count without anyone deciding so then.
      const blog = blogOfEditorRole(role);
      if (Option.isSome(blog) && !(yield* blogs.exists(blog.value))) {
        return yield* new BlogNotFound({ blog: blog.value });
      }
      const now = yield* DateTime.now;
      const change = { userId, role, by: Option.some(actor.id), at: now };
      if (yield* moderation.grantRole(change)) {
        yield* moderation.recordRoleChange({ ...change, change: "granted" });
        yield* DomainEvent.record(
          new RoleGranted({ userId, role, by: actor.id }),
        );
        yield* audit.record({
          action: "role_granted",
          actor: Option.some(actor.id),
          target: Option.some(userId),
          detail: role,
        });
      }
    }, Command.boundary(transaction)),

    grantApprovedBlogEditor: Effect.fn(
      "ModerationCommands.grantApprovedBlogEditor",
    )(function* (userId: UserId, blog: BlogSlug) {
      const { actor } = yield* lockParties(
        yield* Authorized("admin", "superAdmin"),
        userId,
        ["admin", "superAdmin"],
      );
      // Admins grant no other role, and only to someone else for a subblog
      // nobody edits yet: the one their approval just created. Anything
      // else stays with superAdmins (`grantRole`).
      if (actor.id === userId) return yield* new Forbidden();
      const role = blogEditorRole(blog);
      if (!(yield* blogs.exists(blog))) {
        return yield* Effect.die(new Error("Approved blog does not exist"));
      }
      if (yield* moderation.isHeld(role)) {
        return yield* Effect.die(
          new Error("Approved blog has editors already"),
        );
      }
      const now = yield* DateTime.now;
      const change = { userId, role, by: Option.some(actor.id), at: now };
      if (yield* moderation.grantRole(change)) {
        yield* moderation.recordRoleChange({ ...change, change: "granted" });
        yield* DomainEvent.record(
          new RoleGranted({ userId, role, by: actor.id }),
        );
        yield* audit.record({
          action: "role_granted",
          actor: Option.some(actor.id),
          target: Option.some(userId),
          detail: role,
        });
      }
    }, Command.boundary(transaction)),

    revokeRole: Effect.fn("ModerationCommands.revokeRole")(function* (
      userId: UserId,
      role: Role,
    ) {
      const proof = yield* Authorized("superAdmin");
      // Locked before the users, in the same order everywhere, so two
      // revocations can't both see a second superAdmin.
      const superAdmins = yield* moderation.lockSuperAdmins;
      const { actor, targetRoles } = yield* lockParties(proof, userId, [
        "superAdmin",
      ]);
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
      yield* audit.record({
        action: "role_revoked",
        actor: Option.some(actor.id),
        target: Option.some(userId),
        detail: role,
      });
    }, Command.boundary(transaction)),

    restrict: Effect.fn("ModerationCommands.restrict")(function* (
      userId: UserId,
      note: string,
    ) {
      const { actor, target, targetRoles } = yield* lockParties(
        yield* Authorized("admin"),
        userId,
        ["admin"],
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
      yield* audit.record({
        action: "user_restricted",
        actor: Option.some(actor.id),
        target: Option.some(userId),
      });
      return restriction;
    }, Command.boundary(transaction)),

    liftRestriction: Effect.fn("ModerationCommands.liftRestriction")(function* (
      userId: UserId,
      note: Option.Option<string>,
    ) {
      const { actor, target, targetRoles } = yield* lockParties(
        yield* Authorized("admin"),
        userId,
        ["admin"],
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
      yield* audit.record({
        action: "restriction_lifted",
        actor: Option.some(actor.id),
        target: Option.some(userId),
      });
      return lifted;
    }, Command.boundary(transaction)),
  });
});

/**
 * The commands of the moderation domain: everything that changes who holds
 * which role and who is restricted. Every command but `grantInitialRoles`
 * acts on behalf of a moderator and proves it with `Authorized`.
 */
export class ModerationCommands extends Context.Service<
  ModerationCommands,
  {
    /**
     * Grants the roles every new user starts with (`initialRoles`), recorded
     * in the role change log with no actor and the registration time. It
     * takes no role argument and no proof because it can only ever grant
     * those; it is for `UserCommands.syncFromLogin` and joins its
     * transaction, so the user and their roles appear together.
     */
    readonly grantInitialRoles: (
      userId: UserId,
      at: DateTime.Utc,
    ) => Effect.Effect<void>;
    /**
     * Removes every role of a user who deletes their account, logged as
     * revoked with no actor. Refused for a superAdmin. Like
     * `grantInitialRoles` it takes no proof and is for one caller,
     * `UserCommands.deleteAccount`, which acts for the user themselves and
     * joins its transaction.
     */
    readonly releaseUser: (
      userId: UserId,
      at: DateTime.Utc,
    ) => Effect.Effect<void, AccountDeletionNotAllowed>;
    /**
     * Brings the roles a user holds through payments in line with what
     * their payments entitle them to now (from the payments domain, which
     * joins its transaction): grants the missing ones, revokes the paid
     * ones they lost. Roles granted by hand are never touched, and a
     * deleted account gets none. Logged in the role change log with no
     * actor. Takes no proof: it acts for Stripe, and `entitled` can only
     * hold purchasable roles and the roles that come with credits.
     */
    readonly syncPaidRoles: (
      userId: UserId,
      entitled: ReadonlyArray<PurchasableRole | CreditRole>,
    ) => Effect.Effect<void>;
    /**
     * Grants a role (superAdmins only). Granting a role held by hand
     * changes nothing; otherwise (also for one held only through a
     * payment, which it makes a manual grant) it is logged and
     * `RoleGranted` recorded. A
     * `blogEditor:<slug>` role only for an existing subblog (`BlogNotFound`).
     */
    readonly grantRole: (
      userId: UserId,
      role: Role,
    ) => Effect.Effect<
      void,
      UserNotFound | BlogNotFound | Forbidden,
      Authorized<"superAdmin">
    >;
    /**
     * Grants `blogEditor:<blog>` to a user whose blog request an admin or
     * superAdmin approved: the one role they grant without being
     * superAdmins. Never to the moderator themselves (`Forbidden`), and only
     * for a subblog that exists and has no editor yet (a defect otherwise),
     * so it can't make anyone an editor of an existing subblog.
     * Logged like `grantRole`. It is for one caller,
     * `BlogRequestCommands.approve`, which creates the subblog first and
     * joins its transaction.
     */
    readonly grantApprovedBlogEditor: (
      userId: UserId,
      blog: BlogSlug,
    ) => Effect.Effect<
      void,
      UserNotFound | Forbidden,
      Authorized<"admin" | "superAdmin">
    >;
    /**
     * Revokes a role (superAdmins only). Revoking a role the user doesn't
     * hold changes nothing. Nobody revokes their own superAdmin, and the
     * last superAdmin keeps it.
     */
    readonly revokeRole: (
      userId: UserId,
      role: Role,
    ) => Effect.Effect<
      void,
      UserNotFound | RoleChangeNotAllowed | Forbidden,
      Authorized<"superAdmin">
    >;
    /**
     * Restricts an account (admins only): it is blocked until lifted, and
     * its sessions end now. Nobody restricts themselves, and only a
     * superAdmin restricts an admin or superAdmin.
     */
    readonly restrict: (
      userId: UserId,
      note: string,
    ) => Effect.Effect<
      Restriction,
      UserNotFound | AlreadyRestricted | RestrictionNotAllowed | Forbidden,
      Authorized<"admin">
    >;
    /**
     * Lifts the active restriction (admins only), under the same rules,
     * and ends the user's sessions once more: they log in anew.
     */
    readonly liftRestriction: (
      userId: UserId,
      note: Option.Option<string>,
    ) => Effect.Effect<
      Restriction,
      UserNotFound | NotRestricted | RestrictionNotAllowed | Forbidden,
      Authorized<"admin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/moderation/ModerationCommands") {
  /** Needs `UserDirectory`, `BlogDirectory`, `ModerationRepository`, `Sessions`, `AuditCommands` and `Transaction`. */
  static readonly layer = Layer.effect(ModerationCommands, make);
}
