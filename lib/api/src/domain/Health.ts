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
