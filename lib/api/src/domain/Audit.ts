import { UserId } from "#domain/Admin";
import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { Effect, Schema, SchemaGetter } from "effect";

/**
 * What the audit log records. The backend's `audit_log_action_check`
 * constraint allows exactly these values; an action added here needs a
 * migration that widens it, and an action the backend writes must be listed
 * here, or encoding `listAuditLog` fails.
 *
 * - `login`, `logout`: a user's session started or ended (actor = target).
 * - `login_refused`: a login was refused (restricted or deleted account).
 * - `role_granted`, `role_revoked`: `detail` is the role.
 * - `user_restricted`, `restriction_lifted`: by an admin.
 * - `account_deleted`: a user deleted their account (actor = target).
 * - `outbox_retried`: an admin retried an outbox message; `detail` is its
 *   topic.
 * - `contact_message_deleted`: an admin deleted a contact message; no
 *   target and no detail (the message is personal data).
 * - `blog_created`, `blog_updated`: an admin created or edited a blog;
 *   `detail` is its slug.
 * - `post_deleted`: an admin deleted a blog post; `detail` is its id.
 * - `project_created`, `project_updated`, `project_deleted`: an admin
 *   created, edited or deleted a project; `detail` is its slug.
 * - `blog_request_approved`: a moderator (`admin` or `superAdmin`) approved
 *   a blog request; actor = the moderator, target = the requester, `detail`
 *   is the slug of the created blog.
 * - `blog_request_rejected`: a moderator rejected a blog request; actor =
 *   the moderator, target = the requester, no detail (the reason is free
 *   text).
 * - `category_created`: an editor or admin introduced a new category
 *   (editors do so implicitly by naming one); `detail` is its slug.
 * - `category_renamed`, `category_merged`, `category_deleted`: an admin
 *   renamed, merged or deleted a category; `detail` is its slug (for a
 *   rename the new slug, for a merge the source slug).
 */
export const AuditAction = Schema.Literals([
  "login",
  "logout",
  "login_refused",
  "role_granted",
  "role_revoked",
  "user_restricted",
  "restriction_lifted",
  "account_deleted",
  "outbox_retried",
  "contact_message_deleted",
  "blog_created",
  "blog_updated",
  "post_deleted",
  "project_created",
  "project_updated",
  "project_deleted",
  "blog_request_approved",
  "blog_request_rejected",
  "category_created",
  "category_renamed",
  "category_merged",
  "category_deleted",
]).annotate({
  identifier: "AuditAction",
  description: "What an audit log entry records.",
});
export type AuditAction = typeof AuditAction.Type;

/**
 * The id of an audit log entry: a positive safe integer, increasing with
 * each entry (the `bigint` identity of `audit_log`, which the backend
 * converts from the string Postgres returns).
 */
export const AuditLogEntryId = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
)
  .pipe(Schema.brand("AuditLogEntryId"))
  .annotate({
    identifier: "AuditLogEntryId",
    description:
      "The id of an audit log entry, a positive integer that increases " +
      "with each entry.",
  });
export type AuditLogEntryId = typeof AuditLogEntryId.Type;

/** Length limit of `AuditDetail`, the same as the database's check. */
export const AuditDetailMaxLength = 100;

/**
 * A short, non-personal qualifier of an entry, such as the role of
 * `role_granted` or the topic of `outbox_retried`: 1 to 100 characters.
 */
export const AuditDetail = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AuditDetailMaxLength),
).annotate({
  identifier: "AuditDetail",
  description:
    "A short, non-personal qualifier of an audit log entry, such as a role " +
    "name: 1 to 100 characters.",
});
export type AuditDetail = typeof AuditDetail.Type;

/**
 * One audit log entry. The log never holds personal data, only ids and a
 * short qualifier, and outlives the users it mentions: an id of a deleted
 * user simply stops resolving.
 */
export const AuditLogEntry = Schema.Struct({
  id: AuditLogEntryId,
  at: IsoDateTimeUtc,
  action: AuditAction,
  /** Who acted; `null` for the system, an operator or someone not logged in. */
  actorId: Schema.NullOr(UserId),
  /** Who it was done to; `null` if it concerns no user. */
  targetId: Schema.NullOr(UserId),
  detail: Schema.NullOr(AuditDetail),
}).annotate({
  identifier: "AuditLogEntry",
  description:
    "Who did what to whom, and when. `actorId` is null for the system, an " +
    "operator or someone not logged in; `targetId` is null if the entry " +
    "concerns no user.",
});
export type AuditLogEntry = typeof AuditLogEntry.Type;

/** Paging limits of `GET /admin/audit`. */
export const AuditLogLimits = {
  /** Page size when `limit` is absent. */
  defaultLimit: 50,
  /** Largest page size accepted. */
  maxLimit: 100,
} as const;

/**
 * Longest accepted encoded `AuditCursor`. A real cursor is at most about 25
 * characters (`[<id>]` in base64url); longer input is rejected before it is
 * decoded.
 */
export const AuditCursorMaxLength = 64;

/** Decoded form of `AuditCursor`: the position of one entry in the log. */
export interface AuditCursorPosition {
  readonly id: AuditLogEntryId;
}

/**
 * Position in the audit log: the `id` of the last entry of a page. Clients
 * treat it as an opaque string and pass `nextCursor` back as `cursor`. It
 * holds no filter, so it stays valid when `action` or `userId` change (the
 * page then continues below that id with the new filter).
 *
 * Encoded: base64url (no padding) of the JSON array `[id]`. Decoded:
 * `{ id }`. Anything else fails decoding (400), like `UserCursor`.
 */
export const AuditCursor = Schema.String.annotate({
  description:
    "Opaque position in the audit log: pass the `nextCursor` of a page as " +
    "`cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(AuditCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(Schema.fromJsonString(Schema.Tuple([AuditLogEntryId]))),
  Schema.decodeTo(
    // Only the Type of `AuditLogEntryId`: the tuple above has validated it.
    Schema.Struct({ id: Schema.toType(AuditLogEntryId) }),
    {
      decode: SchemaGetter.transform(([id]) => ({ id })),
      encode: SchemaGetter.transform(({ id }) => [id] as const),
    },
  ),
  Schema.annotate({ identifier: "AuditCursor" }),
);
export type AuditCursor = typeof AuditCursor.Type;

/**
 * Query of `GET /admin/audit`. Entries are ordered by `id`, descending
 * (newest first). Decoding fills in the default `limit`; in the generated
 * client `limit` is therefore required (pass `AuditLogLimits.defaultLimit`).
 */
export const AuditLogQuery = Schema.Struct({
  /** Page size, 1 to 100; 50 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: AuditLogLimits.maxLimit }),
  )
    // Described on the key, before the default (see `UserPageQuery`).
    .annotateKey({
      description: "Page size, an integer from 1 to 100; 50 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(
        Effect.succeed(AuditLogLimits.defaultLimit),
      ),
    ),
  /** The `nextCursor` of the previous page; absent for the first page. */
  cursor: Schema.optionalKey(AuditCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
  /** Only entries with this action. */
  action: Schema.optionalKey(AuditAction).annotateKey({
    description: "Only entries with this action.",
  }),
  /** Only entries with this user as actor or as target. */
  userId: Schema.optionalKey(UserId).annotateKey({
    description: "Only entries with this user as actor or as target.",
  }),
}).annotate({ identifier: "AuditLogQuery" });
export type AuditLogQuery = typeof AuditLogQuery.Type;

/** Body of `GET /admin/audit`: one page of the audit log. */
export const AuditLogPage = Schema.Struct({
  entries: Schema.Array(AuditLogEntry),
  /**
   * The position after the last returned entry, to pass as `cursor` for
   * the next page; `null` on the last page.
   */
  nextCursor: Schema.NullOr(AuditCursor),
}).annotate({
  identifier: "AuditLogPage",
  description:
    "One page of the audit log, newest first (by `id`). `nextCursor` is " +
    "the position after the last returned entry, or null on the last page.",
});
export type AuditLogPage = typeof AuditLogPage.Type;
