import { Role } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "./User.ts";

/**
 * Moderation of users: roles granted and revoked by superAdmins, accounts
 * restricted and released by admins. Every change is kept, with who made it
 * and when; `null` for "who" means the system (registration) or an
 * operator in SQL, or an actor whose account was deleted since.
 */

export const RestrictionId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("RestrictionId"),
);
export type RestrictionId = typeof RestrictionId.Type;

/** A restriction of an account: active until `liftedAt` is set. */
export class Restriction extends Model.Class<Restriction>("Restriction")({
  id: RestrictionId,
  userId: UserId,
  note: Schema.String,
  restrictedBy: Schema.OptionFromNullOr(UserId),
  restrictedAt: Schema.DateTimeUtcFromDate,
  liftedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
  liftedBy: Schema.OptionFromNullOr(UserId),
  liftNote: Schema.OptionFromNullOr(Schema.String),
}) {}

export const RoleChangeKind = Schema.Literals(["granted", "revoked"]);
export type RoleChangeKind = typeof RoleChangeKind.Type;

/** One entry of a user's role change log. */
export class RoleChange extends Schema.Class<
  RoleChange,
  { readonly brand: unique symbol }
>("RoleChange")({
  role: Role,
  change: RoleChangeKind,
  changedBy: Schema.OptionFromNullOr(UserId),
  changedAt: Schema.DateTimeUtcFromDate,
}) {}

// Events

export class RoleGranted extends Schema.TaggedClass<
  RoleGranted,
  { readonly brand: unique symbol }
>()("RoleGranted", {
  userId: UserId,
  role: Role,
  by: UserId,
}) {}

export class RoleRevoked extends Schema.TaggedClass<
  RoleRevoked,
  { readonly brand: unique symbol }
>()("RoleRevoked", {
  userId: UserId,
  role: Role,
  by: UserId,
}) {}

export class UserRestricted extends Schema.TaggedClass<
  UserRestricted,
  { readonly brand: unique symbol }
>()("UserRestricted", {
  userId: UserId,
  restrictionId: RestrictionId,
  by: UserId,
}) {}

export class RestrictionLifted extends Schema.TaggedClass<
  RestrictionLifted,
  { readonly brand: unique symbol }
>()("RestrictionLifted", {
  userId: UserId,
  restrictionId: RestrictionId,
  by: UserId,
}) {}

export type ModerationEvent =
  RoleGranted | RoleRevoked | UserRestricted | RestrictionLifted;

// Rules

/** Someone taking part in a moderation decision, with their current roles. */
export interface Party {
  readonly id: UserId;
  readonly roles: ReadonlyArray<Role>;
}

const isPrivileged = (roles: ReadonlyArray<Role>) =>
  roles.includes("admin") || roles.includes("superAdmin");

/**
 * Whether `actor` may restrict `target`, or release them: nobody acts on
 * themselves, and only a superAdmin acts on an admin or superAdmin.
 * Returns why not, if not.
 */
export const restrictionRefusal = (
  actor: Party,
  target: Party,
): Option.Option<"self" | "privilegedTarget"> => {
  if (actor.id === target.id) return Option.some("self");
  if (isPrivileged(target.roles) && !actor.roles.includes("superAdmin")) {
    return Option.some("privilegedTarget");
  }
  return Option.none();
};

/**
 * Whether `actor` may revoke `role` from `target`, who holds it: nobody
 * revokes their own superAdmin, and the last superAdmin keeps it, so there
 * is always someone left who can manage roles. Returns why not, if not.
 */
export const revocationRefusal = (input: {
  readonly actor: UserId;
  readonly target: UserId;
  readonly role: Role;
  /** How many users hold superAdmin, the target included. */
  readonly superAdmins: number;
}): Option.Option<"ownSuperAdmin" | "lastSuperAdmin"> => {
  if (input.role !== "superAdmin") return Option.none();
  if (input.actor === input.target) return Option.some("ownSuperAdmin");
  if (input.superAdmins <= 1) return Option.some("lastSuperAdmin");
  return Option.none();
};
