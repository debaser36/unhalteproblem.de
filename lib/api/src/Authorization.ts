/**
 * Role-based authorization, expressed in the requirements (`R`) of effects,
 * layers and services.
 *
 * Definitions only. The backend provides the `Authorized` proofs and
 * implements the `RequireRoles` and `RequireBlogEditor` middlewares;
 * nothing else may.
 *
 * **Requiring roles in code.** `yield* Authorized("admin")` inside an effect
 * adds `Authorized<"admin">` to its requirements. The effect, and every
 * service method or layer built from it, can then only run where that proof
 * was provided, so a domain service declares "admins only" in its type:
 *
 * ```ts
 * const deleteUser = Effect.fn("UserCommands.delete")(function* (id: UserId) {
 *   const { user } = yield* Authorized("admin", "superAdmin");
 *   // ...
 * });
 * // Effect<void, ..., Authorized<"admin" | "superAdmin"> | ...>
 * ```
 *
 * - **any-of:** `Authorized("admin", "superAdmin")` is one requirement that
 *   any one of the roles meets. Order and duplicates don't matter:
 *   `Authorized("superAdmin", "admin", "admin")` is the same service.
 * - **all-of:** several requirements, each needing its own proof:
 *   `yield* Authorized("admin"); yield* Authorized("superAdmin")` requires
 *   `Authorized<"admin"> | Authorized<"superAdmin">`, so the user must hold
 *   both roles.
 * - **exact:** every role set is a distinct service. `Authorized<"admin">`
 *   does not satisfy `Authorized<"admin" | "superAdmin">` (nor the other way
 *   round), even though an admin meets both: providers always check exactly
 *   the role set that is requested.
 *
 * **Requiring roles on an endpoint.** `RequireRoles("admin")` is the HTTP
 * middleware that checks the roles and provides `Authorized<"admin">` to the
 * endpoint's handler, which can then call services that require it:
 *
 * ```ts
 * // lib/api, next to the endpoints that use it:
 * export const RequireAdmin = RequireRoles("admin");
 *
 * export class AdminGroup extends HttpApiGroup.make("admin")
 *   .add(HttpApiEndpoint.get("stats", "/admin/stats", { success: Stats, error: [] })
 *     .middleware(RequireAdmin))
 *   // After the `.add(...)` above, so it is the outer middleware and runs
 *   // first: `RequireAdmin` needs the `CurrentUser` it provides.
 *   .middleware(Authentication) {}
 * ```
 */
import type { CurrentUser } from "#Authentication";
import type { Role, User } from "#domain/Auth";
import { Forbidden } from "#errors/Forbidden";
import { Context } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { HttpApiMiddleware } from "effect/http-api";

/**
 * Proof that the current user holds at least one of `Roles`: the service
 * identifier of `Authorized(...roles)`, used in requirements.
 *
 * Invariant in `Roles` on purpose, so the proof for one role set never
 * stands in for another (see the module documentation).
 */
export interface Authorized<in out Roles extends Role> {
  readonly "~@unhalteproblem.de/api/Authorized": (_: Roles) => Roles;
}

/** What an `Authorized<Roles>` proof carries. */
export interface Authorization<Roles extends Role> {
  /** The authorized user, with all of their roles. */
  readonly user: User;
  /** The requested roles the user holds; never empty. */
  readonly roles: NonEmptyReadonlyArray<Roles>;
}

/** The roles in a stable order (sorted), without duplicates. */
const canonicalRoles = <Roles extends Role>(
  roles: NonEmptyReadonlyArray<Roles>,
): NonEmptyReadonlyArray<Roles> =>
  [...new Set(roles)].sort() as unknown as NonEmptyReadonlyArray<Roles>;

const authorizedCache = new Map<string, unknown>();

/**
 * The proof that the current user holds at least one of `roles` (any-of),
 * as a service: `yield* Authorized("admin")` requires it and returns its
 * `Authorization`. Require several for all-of.
 *
 * The same role set always gives the same service, whatever the order or
 * duplicates; its key is `@unhalteproblem.de/api/Authorized(<roles>)` with
 * the roles sorted and comma-separated.
 *
 * Only the backend's authorization code may provide it (the `RequireRoles`
 * middlewares, or a check of `CurrentUser`'s roles that fails with
 * `Forbidden`). Never `provideService` it anywhere else, tests aside: that
 * would skip the check.
 *
 * @example
 * ```ts
 * // any-of: admins and super admins
 * const { user, roles } = yield* Authorized("admin", "superAdmin");
 * // all-of: users holding both roles
 * yield* Authorized("admin");
 * yield* Authorized("superAdmin");
 * ```
 */
export const Authorized = <const Roles extends NonEmptyReadonlyArray<Role>>(
  ...roles: Roles
): Context.Service<Authorized<Roles[number]>, Authorization<Roles[number]>> => {
  const key = canonicalRoles(roles).join(",");
  let service = authorizedCache.get(key);
  if (service === undefined) {
    service = Context.Service<
      Authorized<Roles[number]>,
      Authorization<Roles[number]>
    >(`@unhalteproblem.de/api/Authorized(${key})`);
    authorizedCache.set(key, service);
  }
  return service as Context.Service<
    Authorized<Roles[number]>,
    Authorization<Roles[number]>
  >;
};

const makeRequireRoles = <Roles extends Role>(
  roles: NonEmptyReadonlyArray<Roles>,
) => {
  class RequireRoles extends HttpApiMiddleware.Service<
    RequireRoles,
    { provides: Authorized<Roles>; requires: CurrentUser }
  >()(`@unhalteproblem.de/api/RequireRoles(${roles.join(",")})`, {
    error: Forbidden,
  }) {
    /** The required roles (any-of), sorted and without duplicates. */
    static readonly roles: NonEmptyReadonlyArray<Roles> = roles;
    /** The proof the middleware provides, `Authorized(...roles)`. */
    static readonly authorized = Authorized(...roles);
  }
  return RequireRoles;
};

/** The middleware class returned by `RequireRoles(...)` for `Roles`. */
export type RequireRoles<Roles extends Role> = ReturnType<
  typeof makeRequireRoles<Roles>
>;

const requireRolesCache = new Map<string, unknown>();

/**
 * HTTP middleware that lets a request through only if the logged-in user
 * holds at least one of `roles`, and provides `Authorized<roles>` to the
 * handler. Answers 403 `Forbidden` otherwise.
 *
 * - Put it on an endpoint (`HttpApiEndpoint....middleware(RequireAdmin)`) or
 *   on a group.
 * - It requires `CurrentUser`, so apply `Authentication` after it: the
 *   middleware added later is the outer one and runs first. A group's
 *   `.middleware(Authentication)` after the `.add(...)` of the endpoints
 *   does that. Without a session, `Authentication` answers 401 before the
 *   roles are checked. In the wrong order the endpoint keeps `CurrentUser`
 *   as an unmet middleware requirement.
 * - For all-of, apply several (`RequireRoles("admin")` and
 *   `RequireRoles("superAdmin")`); the handler gets both proofs.
 *
 * Define each middleware once, as a constant next to the endpoints that use
 * it (`export const RequireAdmin = RequireRoles("admin")`). The backend must
 * provide an implementation layer for every middleware the API uses; the
 * types enforce that. The same role set always gives the same class,
 * whatever the order or duplicates; `roles` holds the canonical role list
 * and `authorized` the proof to provide.
 *
 * @example
 * ```ts
 * export const RequireAdmin = RequireRoles("admin");
 *
 * HttpApiEndpoint.get("stats", "/admin/stats", { success: Stats, error: [] })
 *   .middleware(RequireAdmin);
 * ```
 */
export const RequireRoles = <const Roles extends NonEmptyReadonlyArray<Role>>(
  ...roles: Roles
): RequireRoles<Roles[number]> => {
  const canonical = canonicalRoles(roles);
  const key = canonical.join(",");
  let middleware = requireRolesCache.get(key);
  if (middleware === undefined) {
    middleware = makeRequireRoles(canonical);
    requireRolesCache.set(key, middleware);
  }
  return middleware as RequireRoles<Roles[number]>;
};

/**
 * HTTP middleware that lets a request through only if the logged-in user
 * holds `blogEditor:<blog>` for the `:blog` path parameter of the endpoint,
 * and answers 403 `Forbidden` otherwise. For endpoints under
 * `/blogs/:blog/...` whose role depends on the path, which `RequireRoles`
 * cannot express.
 *
 * **It provides nothing.** It is a gate in front of the request body, not
 * the proof: the handler still provides `Authorized(blogEditorRole(blog))`
 * itself with the backend's `Authorization.provide` (a cheap second check
 * of `CurrentUser`'s roles) before calling services that require it.
 *
 * **Why a middleware.** `HttpApi` decodes the path parameters and reads and
 * decodes the payload inside the middlewares, right before the handler. A
 * role check in the handler alone would let every logged-in user make the
 * server read and decode a whole body (512 KiB with `LargeBody`, a 5 MiB
 * upload) before answering 403. So it must run before `LargeBody` and the
 * payload: in the runtime order Authentication (401) → `RequireBlogEditor`
 * (403) → `SameOrigin` (403) → `LargeBody` → payload → handler. The
 * middleware added later is the outer one and runs first, so a group adds
 * it after the endpoints (whose `SameOrigin` and `LargeBody` it then
 * wraps) and before `Authentication`:
 *
 * ```ts
 * HttpApiGroup.make("blogEditor")
 *   .add(...endpoints)
 *   .middleware(RequireBlogEditor)
 *   .middleware(Authentication)
 * ```
 *
 * **Implementation (backend).** Because it runs before the parameters are
 * decoded, it reads the raw `blog` parameter from the router's
 * `HttpRouter.RouteContext` and compares `blogEditor:<blog>` with
 * `CurrentUser`'s roles exactly; a missing or non-slug parameter matches no
 * role and answers 403. Only use it on endpoints with a `:blog` path
 * parameter. Declares no security scheme and needs no client middleware.
 */
export class RequireBlogEditor extends HttpApiMiddleware.Service<
  RequireBlogEditor,
  { requires: CurrentUser }
>()("@unhalteproblem.de/api/RequireBlogEditor", { error: Forbidden }) {}
