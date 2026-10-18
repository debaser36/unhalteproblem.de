import { Schema } from "effect";

/**
 * Body of a successful `GET /health` response.
 *
 * Kept as an object (not a bare string or 204) so fields such as a build
 * version can be added later without changing the response encoding.
 */
export const HealthStatus = Schema.Struct({
  status: Schema.Literal("ok"),
}).annotate({
  identifier: "HealthStatus",
  description: "The service is up and able to answer requests.",
});
export type HealthStatus = typeof HealthStatus.Type;

/**
 * Body of a successful `GET /ready` response.
 *
 * Unlike `HealthStatus` it is only sent while the service's dependencies
 * (currently the database) answer. A service that is not ready does not send
 * a different body; it fails with `ServiceUnavailable` (503).
 */
export const ReadyStatus = Schema.Struct({
  status: Schema.Literal("ready"),
}).annotate({
  identifier: "ReadyStatus",
  description: "The service and its dependencies are ready to handle requests.",
});
export type ReadyStatus = typeof ReadyStatus.Type;
