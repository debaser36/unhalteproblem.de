import { Option, Schema } from "effect";
import { UserId } from "#domains/users/User";

/**
 * What can be audited. A new action needs a migration that changes the
 * `audit_log_action_check` constraint.
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
  "payment_refunded",
  "payment_product_updated",
  "payment_product_roles_changed",
  "payment_catalog_synced",
  "payment_product_credits_changed",
]);
export type AuditAction = typeof AuditAction.Type;

/**
 * Something worth remembering, as callers describe it. Ids and a short
 * qualifier only: the log is kept for a year, so it never holds personal
 * data (no names, addresses, notes or IPs).
 */
export interface AuditEntry {
  readonly action: AuditAction;
  /** Who acted; none for the system or someone not logged in. */
  readonly actor: Option.Option<UserId>;
  /** Who it was done to. */
  readonly target: Option.Option<UserId>;
  /** A short, non-personal qualifier, e.g. the role of `role_granted`. */
  readonly detail?: string;
}

/** A stored entry. */
export class AuditRecord extends Schema.Class<
  AuditRecord,
  { readonly brand: unique symbol }
>("AuditRecord")({
  // A bigint in the table, read as `id::float8`: exact far beyond any id it reaches.
  id: Schema.Finite,
  at: Schema.DateTimeUtcFromDate,
  action: AuditAction,
  actorId: Schema.NullOr(UserId),
  targetId: Schema.NullOr(UserId),
  detail: Schema.NullOr(Schema.String),
}) {}
