import { IsoDateTimeUtc, Role } from "#domain/Auth";
import { Subject } from "@unhalteproblem.de/oidc";
import { type DateTime, Effect, Schema, SchemaGetter } from "effect";

/**
 * Our own id of a user (a UUID), assigned by the backend at registration and
 * independent of the identity provider. Admin endpoints address users by it
 * (`/admin/users/:userId`).
 *
 * Not the same as `User.id` of the session (`GET /auth/session`), which is
 * the OIDC subject (`sub`), Keycloak's id of the user; an `AdminUser` carries
 * both, as `id` and `subject`. The backend's domain uses the same brand
 * name, so values pass between the two without conversion.
 */
export const UserId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("UserId"))
  .annotate({
    identifier: "UserId",
    description:
      "Our own id of a user (a UUID). Not the OIDC subject (`sub`), which " +
      "is the session's `User.id`.",
  });
export type UserId = typeof UserId.Type;

/** Length limit of `RestrictionNote`, the same as the database's check. */
export const RestrictionNoteMaxLength = 2000;

// Validated as already trimmed instead of trimmed during decoding, like the
// contact form's fields (see `ContactMessage`): clients trim before sending,
// and the OpenAPI document keeps the constraints. Lengths are UTF-16 code
// units (`string.length`), which never exceed the code points the database
// counts, so a note the API accepts always fits the column.

/**
 * An admin's note on a restriction or on its lift: trimmed, 1 to 2000
 * characters. Visible to admins only, never to the restricted user.
 */
export const RestrictionNote = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RestrictionNoteMaxLength),
).annotate({
  identifier: "RestrictionNote",
  description:
    "An admin's note on a restriction or its lift: trimmed, 1 to 2000 " +
    "characters.",
});
export type RestrictionNote = typeof RestrictionNote.Type;

/**
 * One entry of a user's role change log: a role was granted or revoked.
 * The log is append-only and kept for the audit trail.
 */
export const RoleChange = Schema.Struct({
  role: Role,
  change: Schema.Literals(["granted", "revoked"]),
  /**
   * The superAdmin who made the change. `null` for changes by the system
   * (`normalUser` at registration) or by an operator directly in the
   * database, and for actors whose account has been deleted since.
   */
  changedBy: Schema.NullOr(UserId),
  changedAt: IsoDateTimeUtc,
}).annotate({
  identifier: "RoleChange",
  description:
    "A role grant or revocation. `changedBy` is null for the system, an " +
    "operator, or a deleted actor.",
});
export type RoleChange = typeof RoleChange.Type;

/**
 * An account restriction: while active (`liftedAt` is `null`), the user is
 * blocked; their sessions have been ended and logins are refused
 * (`LoginErrorReason` `restricted`). Lifting keeps the record, so a user's
 * restrictions are also their history.
 */
export const Restriction = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  /** Why the account was restricted. */
  note: RestrictionNote,
  /**
   * The admin who restricted the account; `null` only if their account has
   * been deleted since.
   */
  restrictedBy: Schema.NullOr(UserId),
  restrictedAt: IsoDateTimeUtc,
  /** When the restriction was lifted; `null` while it is active. */
  liftedAt: Schema.NullOr(IsoDateTimeUtc),
  /**
   * The admin who lifted it; `null` while active, or if their account has
   * been deleted since.
   */
  liftedBy: Schema.NullOr(UserId),
  /** The note given with the lift, if any. */
  liftNote: Schema.NullOr(RestrictionNote),
}).annotate({
  identifier: "Restriction",
  description:
    "An account restriction, active while `liftedAt` is null. Lifted " +
    "restrictions are kept as history.",
});
export type Restriction = typeof Restriction.Type;

/**
 * A user as admins see it: every stored field, the current roles and the
 * active restriction. Fields without a value are `null` rather than
 * missing, so every field is always present. Users who deleted their
 * account remain as tombstones, marked by `deletedAt` (see there).
 */
export const AdminUser = Schema.Struct({
  id: UserId,
  /** The OIDC subject (`sub`): Keycloak's id, the session's `User.id`. */
  subject: Subject,
  /** `preferred_username`; a display hint, not unique or stable. */
  username: Schema.NullOr(Schema.String),
  /** The full name (`name`). */
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  /** Whether Keycloak has verified `email` (`email_verified`). */
  emailVerified: Schema.Boolean,
  /** When the user first logged in (registered). */
  createdAt: IsoDateTimeUtc,
  /** When the profile last changed. */
  updatedAt: IsoDateTimeUtc,
  lastLoginAt: IsoDateTimeUtc,
  /**
   * When the user deleted their account; `null` for a live account. A
   * deleted user stays in the list as an anonymised tombstone: no
   * `username`, `name` or `email`, no `roles`, and they cannot log in.
   * Admins cannot restrict them meaningfully.
   */
  deletedAt: Schema.NullOr(IsoDateTimeUtc),
  /** The current roles. */
  roles: Schema.Array(Role),
  /** The active restriction; `null` if the account is not restricted. */
  restriction: Schema.NullOr(Restriction),
}).annotate({
  identifier: "AdminUser",
  description:
    "A user with all stored fields, roles and the active restriction, as " +
    "admins see it. A non-null `deletedAt` marks an anonymised tombstone " +
    "of a deleted account: no username, name, email or roles, no login, " +
    "and no meaningful restriction.",
});
export type AdminUser = typeof AdminUser.Type;

/** Body of `GET /admin/users/:userId`: a user with their full history. */
export const AdminUserDetails = Schema.Struct({
  ...AdminUser.fields,
  /** All restrictions, active and lifted, newest first. */
  restrictions: Schema.Array(Restriction),
  /** The role change log, oldest first. */
  roleChanges: Schema.Array(RoleChange),
}).annotate({
  identifier: "AdminUserDetails",
  description:
    "A user with all restrictions (newest first) and the role change log " +
    "(oldest first).",
});
export type AdminUserDetails = typeof AdminUserDetails.Type;

/** Paging limits of `GET /admin/users`. */
export const UserPageLimits = {
  /** Page size when `limit` is absent. */
  defaultLimit: 50,
  /** Largest page size accepted. */
  maxLimit: 200,
} as const;

/**
 * Longest accepted encoded `UserCursor`. A real cursor is about 70
 * characters (`[<epoch millis>,"<uuid>"]` in base64url); the rest is room
 * for the extremes of `DateTime`, so longer input is rejected before it is
 * decoded.
 */
export const UserCursorMaxLength = 128;

/** Decoded form of `UserCursor`: the position of one user in the order. */
export interface UserCursorPosition {
  /** `createdAt` of the user, at millisecond precision. */
  readonly createdAt: DateTime.Utc;
  readonly id: UserId;
}

/**
 * Position in the user list: the `createdAt` and `id` of the last user of a
 * page. Clients treat it as an opaque string and pass `nextCursor` back as
 * `cursor`.
 *
 * Encoded: base64url (no padding) of the JSON array
 * `[createdAtEpochMillis, userId]`. Decoded: `{ createdAt, id }`. Anything
 * else (not base64url, not that JSON, a malformed id or timestamp, longer
 * than `UserCursorMaxLength`) fails decoding, which the endpoint answers
 * with 400.
 */
export const UserCursor = Schema.String.annotate({
  description:
    "Opaque position in the user list: pass the `nextCursor` of a page " +
    "as `cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(UserCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(Schema.Tuple([Schema.DateTimeUtcFromMillis, UserId])),
  ),
  Schema.decodeTo(
    Schema.Struct({
      createdAt: Schema.DateTimeUtc,
      // Only the Type of `UserId`: the tuple above has validated it.
      id: Schema.toType(UserId),
    }),
    {
      decode: SchemaGetter.transform(([createdAt, id]) => ({ createdAt, id })),
      encode: SchemaGetter.transform(
        ({ createdAt, id }) => [createdAt, id] as const,
      ),
    },
  ),
  Schema.annotate({ identifier: "UserCursor" }),
);
export type UserCursor = typeof UserCursor.Type;

/**
 * Query of `GET /admin/users`. Both parameters may be left out of the URL;
 * decoding fills in the default `limit`, so handlers always see a number.
 * Users are ordered by `createdAt`, then `id`, ascending (oldest first).
 *
 * In the generated client `limit` is required: its request type is the
 * decoded type. Pass the default explicitly (`UserPageLimits`).
 */
export const UserPageQuery = Schema.Struct({
  /** Page size, 1 to 200; 50 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: UserPageLimits.maxLimit }),
  )
    // Described on the key, before the default (only there it reaches the
    // OpenAPI parameter): query parameters are documented as strings, so
    // the bounds of `Int` would not show otherwise.
    .annotateKey({
      description: "Page size, an integer from 1 to 200; 50 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(
        Effect.succeed(UserPageLimits.defaultLimit),
      ),
    ),
  /**
   * The `nextCursor` of the previous page. Absent for the first page. The
   * page starts right after the position it holds.
   */
  cursor: Schema.optionalKey(UserCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
}).annotate({ identifier: "UserPageQuery" });
export type UserPageQuery = typeof UserPageQuery.Type;

/** Body of `GET /admin/users`: one page of users. */
export const UserPage = Schema.Struct({
  users: Schema.Array(AdminUser),
  /**
   * The position after the last returned user, to pass as `cursor` for the
   * next page; `null` on the last page.
   */
  nextCursor: Schema.NullOr(UserCursor),
}).annotate({
  identifier: "UserPage",
  description:
    "One page of users, ordered by `createdAt`, then `id` (oldest first). " +
    "`nextCursor` is the position after the last returned user, or null " +
    "on the last page.",
});
export type UserPage = typeof UserPage.Type;

/** Payload of `POST /admin/users/:userId/restriction`. */
export const RestrictPayload = Schema.Struct({
  /** Why the account is restricted; required. */
  note: RestrictionNote,
}).annotate({ identifier: "RestrictPayload" });
export type RestrictPayload = typeof RestrictPayload.Type;

/** Payload of `POST /admin/users/:userId/restriction/lift`. */
export const LiftRestrictionPayload = Schema.Struct({
  /** An optional note on the lift. */
  note: Schema.optionalKey(RestrictionNote),
}).annotate({ identifier: "LiftRestrictionPayload" });
export type LiftRestrictionPayload = typeof LiftRestrictionPayload.Type;
