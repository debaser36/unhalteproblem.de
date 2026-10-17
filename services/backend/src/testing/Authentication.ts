import { Authentication, Unauthorized } from "@unhalteproblem.de/api";
import { Effect, Layer } from "effect";

/**
 * An `Authentication` that rejects every request, for tests of groups that
 * don't use it: `HttpApiTest` needs the middleware of the whole API.
 */
export const AuthenticationRejectAll = Layer.succeed(Authentication)({
  session: () => Effect.fail(new Unauthorized()),
});
