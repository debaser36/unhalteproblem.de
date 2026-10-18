import type { Role } from "@unhalteproblem.de/api";
import { Subject } from "@unhalteproblem.de/oidc";
import {
  Array as Arr,
  type DateTime,
  Equal,
  type Option,
  Schema,
} from "effect";
import { Model } from "effect/schema";

/** Our own id of a user, independent of the identity provider. */
export const UserId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("UserId"),
);
export type UserId = typeof UserId.Type;

/**
 * A person who has logged in at least once. Keycloak owns the identity and
 * the profile; this is our copy of it, refreshed at every login, which the
 * rest of the backend can reference by `id`.
 */
export class User extends Model.Class<User>("User")({
  id: UserId,
  /** The OIDC `sub`: Keycloak's stable id of the user. Never changes. */
  subject: Subject.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  /** `preferred_username`; a display hint, not unique or stable. */
  username: Schema.OptionFromNullOr(Schema.String),
  name: Schema.OptionFromNullOr(Schema.String),
  email: Schema.OptionFromNullOr(Schema.String),
  emailVerified: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  /** When the profile last changed. */
  updatedAt: Schema.DateTimeUtcFromDate,
  lastLoginAt: Schema.DateTimeUtcFromDate,
}) {}

/** The profile as Keycloak reports it at login. */
export interface UserProfile {
  readonly username: Option.Option<string>;
  readonly name: Option.Option<string>;
  readonly email: Option.Option<string>;
  readonly emailVerified: boolean;
}

export const ProfileField = Schema.Literals([
  "username",
  "name",
  "email",
  "emailVerified",
]);
export type ProfileField = typeof ProfileField.Type;

// Events

/** A user logged in for the first time. */
export class UserRegistered extends Schema.TaggedClass<
  UserRegistered,
  { readonly brand: unique symbol }
>()("UserRegistered", { userId: UserId }) {}

/** A user's profile in Keycloak changed since their last login. */
export class UserProfileChanged extends Schema.TaggedClass<
  UserProfileChanged,
  { readonly brand: unique symbol }
>()("UserProfileChanged", {
  userId: UserId,
  /** Which fields changed; their values are in the user. */
  fields: Schema.NonEmptyArray(ProfileField),
}) {}

export type UserEvent = UserRegistered | UserProfileChanged;

// Errors

/** No user with this id; the contract's error, so it maps to 404 as is. */
export { UserNotFound } from "@unhalteproblem.de/api";

// Rules. Pure functions from the current state to the new state and the
// events describing the change; the commands load, apply and store.

/**
 * The roles every user gets at registration. More are granted by an
 * operator (see the backend README, section "Authorization").
 */
export const initialRoles: ReadonlyArray<Role> = ["normalUser"];

/** The user for a subject that logs in for the first time. */
export const register = (input: {
  readonly id: UserId;
  readonly subject: typeof Subject.Type;
  readonly profile: UserProfile;
  readonly now: DateTime.Utc;
}): {
  readonly user: User;
  readonly roles: ReadonlyArray<Role>;
  readonly events: ReadonlyArray<UserEvent>;
} => ({
  user: new User({
    id: input.id,
    subject: input.subject,
    ...input.profile,
    createdAt: input.now,
    updatedAt: input.now,
    lastLoginAt: input.now,
  }),
  roles: initialRoles,
  events: [new UserRegistered({ userId: input.id })],
});

/** A known user logs in again, with their current profile from Keycloak. */
export const logIn = (
  user: User,
  profile: UserProfile,
  now: DateTime.Utc,
): { readonly user: User; readonly events: ReadonlyArray<UserEvent> } => {
  const changed = ProfileField.literals.filter(
    (field) => !Equal.equals(user[field], profile[field]),
  );
  return {
    user: new User({
      ...user,
      ...profile,
      updatedAt: changed.length > 0 ? now : user.updatedAt,
      lastLoginAt: now,
    }),
    events: Arr.isArrayNonEmpty(changed)
      ? [new UserProfileChanged({ userId: user.id, fields: changed })]
      : [],
  };
};
