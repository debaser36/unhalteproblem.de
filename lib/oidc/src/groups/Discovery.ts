import { JsonWebKeySet } from "#domain/Jose";
import { ProviderMetadata } from "#domain/ProviderMetadata";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/** Provider configuration and signing keys. Public, no authentication. */
export class DiscoveryGroup extends HttpApiGroup.make("discovery")
  .add(
    HttpApiEndpoint.get("configuration", "/.well-known/openid-configuration", {
      success: ProviderMetadata,
      // Failures are transport-level (unreachable Keycloak, unknown realm
      // answering 404); there are no protocol errors to decode.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "OpenID Provider configuration",
        description:
          "Discovery document (OpenID Connect Discovery 1.0 §4) with the " +
          "issuer, endpoint URLs and supported features.",
      }),
    ),
    HttpApiEndpoint.get("keys", "/protocol/openid-connect/certs", {
      success: JsonWebKeySet,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "JSON Web Key Set",
        description:
          "The provider's public keys (`jwks_uri`). Keys rotate: when a " +
          "token's `kid` is unknown, fetch the set again before rejecting it.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Discovery",
      description: "Provider metadata and public keys.",
    }),
  ) {}
