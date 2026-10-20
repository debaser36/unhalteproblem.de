import {
  type Authorization,
  Authorized,
  BlogSlug,
  blogEditorRole,
  CurrentUser,
  Forbidden,
  RequireBlogEditor,
  type RequireRoles,
  type Role,
} from "@unhalteproblem.de/api";
import { Array as Arr, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/http";
import type { NonEmptyReadonlyArray } from "effect/Array";

/**
 * The only place that hands out `Authorized` proofs: each one checks the
 * roles of `CurrentUser` (read from the database on every request) and fails
 * with `Forbidden` (403) if the user holds none of the required roles.
 *
 * Code that needs a role says so in its requirements, and whoever runs it
 * provides the proof with one of these:
 *
 * ```ts
 * // a domain service method, for admins only:
 * const deletePost = Effect.fn("Posts.delete")(function* (id: PostId) {
 *   yield* Authorized("admin");
 *   // ...
 * });
 *
 * // a handler of an endpoint without `RequireRoles`:
 * handlers.handle("deletePost", ({ path }) =>
 *   deletePost(path.id).pipe(Authorization.provide("admin")),
 * );
 * ```
 */

/**
 * Checks that the current user holds at least one of `roles` (any-of), and
 * returns which of them they hold.
 */
export const authorize = <const Roles extends NonEmptyReadonlyArray<Role>>(
  ...roles: Roles
): Effect.Effect<Authorization<Roles[number]>, Forbidden, CurrentUser> =>
  Effect.gen(function* () {
    const { user } = yield* CurrentUser;
    const held = roles.filter((role) => user.roles.includes(role));
    if (!Arr.isReadonlyArrayNonEmpty(held)) {
      yield* Effect.logWarning("Access denied").pipe(
        Effect.annotateLogs({ userId: user.id, required: roles }),
      );
      return yield* new Forbidden();
    }
    return { user, roles: held };
  }).pipe(
    Effect.withSpan("Authorization.authorize", { attributes: { roles } }),
  );

/**
 * Provides `Authorized<Roles>` to an effect after checking the current
 * user: removes that requirement, adds `CurrentUser` and `Forbidden`.
 * Requires all-of by providing several proofs one after the other.
 */
export const provide =
  <const Roles extends NonEmptyReadonlyArray<Role>>(...roles: Roles) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A,
    E | Forbidden,
    Exclude<R, Authorized<Roles[number]>> | CurrentUser
  > =>
    Effect.flatMap(authorize(...roles), (authorization) =>
      Effect.provideService(self, Authorized(...roles), authorization),
    );

/**
 * `Authorized<Roles>` as a layer, for code that is composed from layers
 * built per request (it checks when it is built). Fresh, so a proof is never
 * shared through layer memoization, not even by accident.
 */
export const layer = <const Roles extends NonEmptyReadonlyArray<Role>>(
  ...roles: Roles
): Layer.Layer<Authorized<Roles[number]>, Forbidden, CurrentUser> =>
  Layer.fresh(Layer.effect(Authorized(...roles), authorize(...roles)));

/**
 * The implementation of a `RequireRoles` middleware from the contract.
 * Every one the API uses needs this layer; the types of `HttpApiBuilder`
 * enforce that.
 */
export const middleware = <Roles extends Role>(
  requireRoles: RequireRoles<Roles>,
) =>
  Layer.succeed(requireRoles, (httpEffect) =>
    Effect.flatMap(authorize(...requireRoles.roles), (authorization) =>
      Effect.provideService(httpEffect, requireRoles.authorized, authorization),
    ),
  );

/**
 * The implementation of the contract's `RequireBlogEditor`: lets a request
 * to `/blogs/:blog/manage/...` through only if the current user holds
 * `blogEditor:<blog>`. It runs before the payload is read, so nobody else
 * can make the server read a large post body (`LargeBody`). It provides no
 * proof: the handlers still provide `Authorized(blogEditorRole(blog))` with
 * `provide`, which checks the same role again for the typed requirement.
 * A path whose `:blog` is not a valid slug names no subblog anyone edits:
 * 403 as well.
 */
export const blogEditorMiddleware = Layer.succeed(
  RequireBlogEditor,
  (httpEffect) =>
    Effect.gen(function* () {
      const { blog } = yield* HttpRouter.params;
      const slug = decodeBlogSlug(blog);
      if (Option.isNone(slug)) return yield* new Forbidden();
      yield* authorize(blogEditorRole(slug.value));
      return yield* httpEffect;
    }),
);

const decodeBlogSlug = Schema.decodeUnknownOption(BlogSlug);
