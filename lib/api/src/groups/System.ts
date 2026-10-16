import { HealthStatus } from "#domain/Health";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/**
 * Operational endpoints.
 *
 * `topLevel: true` puts the endpoints on the root of the generated client
 * (`client.health()`) and keeps their OpenAPI operation ids unprefixed.
 */
export class SystemGroup extends HttpApiGroup.make("system", { topLevel: true })
  .add(
    // Public on purpose: load balancers, uptime monitors and deploy checks
    // call it without credentials, and it reveals nothing beyond "the
    // service is up".
    HttpApiEndpoint.get("health", "/health", {
      success: HealthStatus,
      // No domain errors. Unreachable or broken services fail at the
      // transport level, which is what a health probe looks for.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Health check",
        description:
          'Returns `{ status: "ok" }` while the service can answer requests.',
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "System",
      description: "Operational endpoints such as health checks.",
    }),
  ) {}
