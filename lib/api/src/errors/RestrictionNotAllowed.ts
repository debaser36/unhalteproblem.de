import { Schema } from "effect";

/**
 * The caller holds `admin` but may not restrict, or lift the restriction of,
 * this particular user (403):
 *
 * - `self`: nobody may restrict or lift their own account.
 * - `privilegedTarget`: the target holds `admin` or `superAdmin`, and the
 *   caller does not hold `superAdmin`. Only superAdmins may restrict or lift
 *   other admins and superAdmins.
 *
 * Unlike `Forbidden` (the caller lacks the endpoint's role), this depends
 * on the target user.
 */
export class RestrictionNotAllowed extends Schema.TaggedError<
  RestrictionNotAllowed,
  { readonly brand: unique symbol }
>()(
  "RestrictionNotAllowed",
  { reason: Schema.Literals(["self", "privilegedTarget"]) },
  {
    httpApiStatus: 403,
    description:
      "Not allowed to restrict or lift this user: it is the caller " +
      "(`self`), or an admin or superAdmin and the caller is no superAdmin " +
      "(`privilegedTarget`).",
  },
) {}
