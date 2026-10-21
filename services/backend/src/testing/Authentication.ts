import {
  Authentication,
  Forbidden,
  LargeBody,
  RequireAdmin,
  RequireBlogEditor,
  RequireBlogRequestModerator,
  RequireSuperAdmin,
  SameOrigin,
  Unauthorized,
} from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";

/**
 * An `Authentication` that rejects every request, for tests of groups that
 * don't use it: `HttpApiTest` needs the middleware of the whole API.
 */
export const AuthenticationRejectAll = Layer.succeed(Authentication)({
  session: () => Effect.fail(new Unauthorized()),
});

/**
 * Every middleware of the API, each rejecting every request; for tests of
 * groups that use none of them. They never provide anything, so they can't
 * stand in for a real check.
 */
export const MiddlewaresRejectAll = Layer.mergeAll(
  AuthenticationRejectAll,
  Layer.succeed(RequireAdmin, () => Effect.fail(new Forbidden())),
  Layer.succeed(RequireSuperAdmin, () => Effect.fail(new Forbidden())),
  Layer.succeed(RequireBlogEditor, () => Effect.fail(new Forbidden())),
  Layer.succeed(RequireBlogRequestModerator, () =>
    Effect.fail(new Forbidden()),
  ),
  Layer.succeed(SameOrigin, () => Effect.fail(new Forbidden())),
  // Raises a limit, checks nothing: passing the request on is all it does.
  Layer.succeed(LargeBody, (httpEffect) => httpEffect),
);
