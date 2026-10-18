import { Schema } from "effect";

/**
 * The role change would leave the site without a working superAdmin, so it
 * is refused (409):
 *
 * - `ownSuperAdmin`: a superAdmin may not revoke `superAdmin` from
 *   themselves.
 * - `lastSuperAdmin`: the target is the last remaining superAdmin.
 *
 * A conflict with the current state rather than a missing permission, hence
 * 409: the caller is a superAdmin and may change roles in general.
 */
export class RoleChangeNotAllowed extends Schema.TaggedError<
  RoleChangeNotAllowed,
  { readonly brand: unique symbol }
>()(
  "RoleChangeNotAllowed",
  { reason: Schema.Literals(["ownSuperAdmin", "lastSuperAdmin"]) },
  {
    httpApiStatus: 409,
    description:
      "The role change is refused: superAdmins may not revoke their own " +
      "`superAdmin` (`ownSuperAdmin`), and the last superAdmin keeps it " +
      "(`lastSuperAdmin`).",
  },
) {}
