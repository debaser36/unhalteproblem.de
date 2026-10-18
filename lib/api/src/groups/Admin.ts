import { Authentication } from "#Authentication";
import { RequireRoles } from "#Authorization";
import {
  AdminUserDetails,
  LiftRestrictionPayload,
  RestrictPayload,
  Restriction,
  UserId,
  UserPage,
  UserPageQuery,
} from "#domain/Admin";
import { Role } from "#domain/Auth";
import { AlreadyRestricted } from "#errors/AlreadyRestricted";
import { NotRestricted } from "#errors/NotRestricted";
import { RestrictionNotAllowed } from "#errors/RestrictionNotAllowed";
import { RoleChangeNotAllowed } from "#errors/RoleChangeNotAllowed";
import { UserNotFound } from "#errors/UserNotFound";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** Requires `admin`: user administration (listing, restrictions). */
export const RequireAdmin = RequireRoles("admin");

/**
 * Requires `superAdmin`: granting and revoking roles. Roles are flat, so a
 * superAdmin needs `admin` as well to use the `RequireAdmin` endpoints.
 */
export const RequireSuperAdmin = RequireRoles("superAdmin");

/** Path parameters of the endpoints for one user. */
const UserParams = { userId: UserId };

/** Path parameters of the endpoints for one role of one user. */
const UserRoleParams = { userId: UserId, role: Role };

/**
 * Success of `restrictUser`: the new `Restriction`, with status 201.
 *
 * Wrapped in a one-member union because annotating `Restriction` itself
 * with the status would make a second schema with the same identifier,
 * which the OpenAPI document then lists twice (`Restriction` and
 * `Restriction_1`). The union carries the status and references the one
 * `Restriction` component; its type and encoding are `Restriction`'s.
 */
const CreatedRestriction = Schema.Union([Restriction])
  .pipe(HttpApiSchema.status(201))
  .annotate({ description: "The new restriction." });

// Shared by `restrictUser` and `liftRestriction`.
const restrictionRules =
  "Nobody may restrict or lift their own account, and a caller without " +
  "`superAdmin` may only act on users who hold neither `admin` nor " +
  "`superAdmin`; otherwise 403 `RestrictionNotAllowed`.";

/**
 * User administration: admins see every user, restrict (block) and lift
 * restrictions; superAdmins grant and revoke roles. Every change is
 * recorded with who made it and when, and shows up in `getUser`.
 *
 * Every endpoint requires a session (`Authentication`, 401) and a role
 * (`RequireAdmin` or `RequireSuperAdmin`, 403 `Forbidden`). The
 * state-changing ones also require `SameOrigin` (403 `Forbidden` for a
 * foreign or missing `Origin`).
 *
 * Middleware order: the endpoint's own middlewares run inside the group's
 * `Authentication`, which is added after the endpoints so it runs first
 * (see `RequireRoles`). On an endpoint, `SameOrigin` is added after the
 * role middleware, so the origin is checked before the roles.
 */
export class AdminGroup extends HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("listUsers", "/admin/users", {
      query: UserPageQuery,
      success: UserPage,
      // An invalid `limit` or `offset` is rejected by schema validation
      // (400). 401 and 403 come from the middlewares.
      error: [],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List users",
          description:
            "Requires `admin`. Returns one page of all users with every " +
            "stored field, their roles and the active restriction, ordered " +
            "by `createdAt`, then `id`, plus the total number of users. " +
            "`limit` is 1 to 200 (default 50), `offset` at least 0 " +
            "(default 0).",
        }),
      ),
    HttpApiEndpoint.get("getUser", "/admin/users/:userId", {
      params: UserParams,
      success: AdminUserDetails,
      error: UserNotFound,
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Get a user",
          description:
            "Requires `admin`. Returns the user with every stored field, " +
            "their roles, the active restriction, all restrictions (newest " +
            "first, with who restricted and lifted them, when, and the " +
            "notes) and the role change log (oldest first, with who made " +
            "each change and when). Answers 404 `UserNotFound` for an " +
            "unknown id.",
        }),
      ),
    HttpApiEndpoint.post("restrictUser", "/admin/users/:userId/restriction", {
      params: UserParams,
      payload: RestrictPayload,
      success: CreatedRestriction,
      error: [UserNotFound, AlreadyRestricted, RestrictionNotAllowed],
    })
      .middleware(RequireAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Restrict a user",
          description:
            "Requires `admin` and a same-origin request. Blocks the " +
            "account until the restriction is lifted: the user's sessions " +
            "are ended and their logins are refused (`login_error=" +
            "restricted`). The note is required and records why; the " +
            "restriction records the caller and the time. Answers 201 " +
            "with the new restriction, 409 `AlreadyRestricted` if the user " +
            "already has an active one, and 404 `UserNotFound` for an " +
            "unknown id. " +
            restrictionRules,
        }),
      ),
    HttpApiEndpoint.post(
      "liftRestriction",
      "/admin/users/:userId/restriction/lift",
      {
        params: UserParams,
        payload: LiftRestrictionPayload,
        // Not annotated: that would duplicate the component (see
        // `CreatedRestriction`).
        success: Restriction,
        error: [UserNotFound, NotRestricted, RestrictionNotAllowed],
      },
    )
      .middleware(RequireAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Lift a restriction",
          description:
            "Requires `admin` and a same-origin request. Lifts the user's " +
            "active restriction, so they can log in again; the user has " +
            "to log in anew, since their sessions were ended. The " +
            "restriction is kept as history, with the caller, the time and " +
            "the optional note of the lift. Answers 200 with the lifted " +
            "restriction, 409 `NotRestricted` if the user has no active " +
            "one, and 404 `UserNotFound` for an unknown id. " +
            restrictionRules,
        }),
      ),
    HttpApiEndpoint.put("grantRole", "/admin/users/:userId/roles/:role", {
      params: UserRoleParams,
      success: HttpApiSchema.NoContent.annotate({
        description: "The user holds the role.",
      }),
      error: UserNotFound,
    })
      .middleware(RequireSuperAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Grant a role",
          description:
            "Requires `superAdmin` and a same-origin request. Grants any " +
            "role, including `superAdmin`, to any user, the caller " +
            "included. Idempotent: granting a role the user already holds " +
            "answers 204 as well and changes nothing. A grant records the " +
            "caller and the time in the role change log. The new role " +
            "takes effect on the user's next request. Answers 404 " +
            "`UserNotFound` for an unknown id.",
        }),
      ),
    HttpApiEndpoint.delete("revokeRole", "/admin/users/:userId/roles/:role", {
      params: UserRoleParams,
      success: HttpApiSchema.NoContent.annotate({
        description: "The user does not hold the role.",
      }),
      error: [UserNotFound, RoleChangeNotAllowed],
    })
      .middleware(RequireSuperAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Revoke a role",
          description:
            "Requires `superAdmin` and a same-origin request. Revokes any " +
            "role from any user. Idempotent: revoking a role the user does " +
            "not hold answers 204 as well and changes nothing. A " +
            "revocation records the caller and the time in the role change " +
            "log, and takes effect on the user's next request. Refused " +
            "with 409 `RoleChangeNotAllowed` when revoking `superAdmin` " +
            "from the caller (`ownSuperAdmin`) or from the last remaining " +
            "superAdmin (`lastSuperAdmin`). Answers 404 `UserNotFound` for " +
            "an unknown id.",
        }),
      ),
  )
  // Protects every endpoint above; added after them, so it runs before
  // their role middlewares and answers 401 before any 403.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Admin",
      description:
        "User administration. Admins list users and restrict or lift " +
        "restrictions; superAdmins grant and revoke roles. Every change is " +
        "recorded with who made it and when.",
    }),
  ) {}
