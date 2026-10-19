import { Schema } from "effect";

/**
 * The account cannot be deleted right now, so the request is refused (409):
 *
 * - `superAdmin`: the caller holds the `superAdmin` role. Another superAdmin
 *   has to revoke it first (`DELETE /admin/users/:userId/roles/superAdmin`),
 *   so that deleting accounts can never remove the last superAdmin.
 *
 * A conflict with the current state rather than a missing permission, hence
 * 409: deleting one's own account is allowed in general, and it works once
 * the role is gone.
 */
export class AccountDeletionNotAllowed extends Schema.TaggedError<
  AccountDeletionNotAllowed,
  { readonly brand: unique symbol }
>()(
  "AccountDeletionNotAllowed",
  { reason: Schema.Literals(["superAdmin"]) },
  {
    httpApiStatus: 409,
    description:
      "The account cannot be deleted: a superAdmin must first have another " +
      "superAdmin revoke their `superAdmin` role (`superAdmin`).",
  },
) {}
