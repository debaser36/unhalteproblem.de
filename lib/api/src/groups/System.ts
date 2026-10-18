import { HealthStatus, ReadyStatus } from "#domain/Health";
import { ServiceUnavailable } from "#errors/ServiceUnavailable";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Operational endpoints.
 *
 * `topLevel: true` puts the endpoints on the root of the generated client
 * (`client.health()`, `client.ready()`) and keeps their OpenAPI operation ids
 * unprefixed.
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
    // Public on purpose, for the same reason as `health`: orchestrators and
    // load balancers probe it without credentials, and it reveals nothing
    // beyond "the service can reach its database".
    HttpApiEndpoint.get("ready", "/ready", {
      success: ReadyStatus,
      // A service that is not ready answers 503 without a body, which is
      // what a readiness probe looks for. It is declared (and not left to
      // the transport level) so that the backend can return it.
      error: ServiceUnavailable.pipe(
        HttpApiSchema.asNoContent({ decode: () => new ServiceUnavailable() }),
      ),
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Readiness check",
        description:
          'Returns `{ status: "ready" }` while the service can answer requests and its database answers. Unlike `/health` it also checks the database. A service that is not ready answers `503 Service Unavailable` with an empty body.',
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "System",
      description: "Operational endpoints such as health and readiness checks.",
    }),
  ) {}
