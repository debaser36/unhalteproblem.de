import { IntrospectionResponse } from "#domain/Claims";
import {
  IntrospectionRequest,
  RevocationRequest,
  TokenRequest,
  TokenResponse,
} from "#domain/Token";
import { OAuthBadRequest, OAuthUnauthorized } from "#errors/OAuthError";
import { ClientSecretBasic } from "#middleware/ClientSecretBasic";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Endpoints called by the client directly ("back channel"), with client
 * authentication: `client_secret_basic` through the `ClientSecretBasic`
 * middleware, or `client_id` (and `client_secret`) in the form body.
 *
 * Keycloak answers 400 for invalid requests, grants and scopes, and 401 for
 * failed client authentication (`invalid_client`).
 */
export class TokenGroup extends HttpApiGroup.make("token")
  .add(
    HttpApiEndpoint.post("grant", "/protocol/openid-connect/token", {
      payload: TokenRequest,
      success: TokenResponse,
      error: [OAuthBadRequest, OAuthUnauthorized],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Token request",
        description:
          "Exchanges an authorization code, a refresh token or client " +
          "credentials for tokens (RFC 6749 §3.2, OIDC Core §3.1.3).",
      }),
    ),
    HttpApiEndpoint.post("revoke", "/protocol/openid-connect/revoke", {
      payload: RevocationRequest,
      // 200 with an empty body, also for tokens that were already invalid
      // (RFC 7009 §2.2), so revocation can be retried safely.
      success: HttpApiSchema.Empty(200),
      error: [OAuthBadRequest, OAuthUnauthorized],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Token revocation",
        description: "Revokes an access or refresh token (RFC 7009).",
      }),
    ),
    HttpApiEndpoint.post(
      "introspect",
      "/protocol/openid-connect/token/introspect",
      {
        payload: IntrospectionRequest,
        success: IntrospectionResponse,
        error: [OAuthBadRequest, OAuthUnauthorized],
      },
    ).annotateMerge(
      OpenApi.annotations({
        summary: "Token introspection",
        description:
          "Tells a confidential client whether a token is active, and its " +
          "claims if it is (RFC 7662).",
      }),
    ),
  )
  // After the endpoints: middleware only applies to endpoints already added.
  // The OpenAPI document lists it as required, but the generated client
  // skips it unless `layerClientSecretBasic` is provided.
  .middleware(ClientSecretBasic)
  .annotateMerge(
    OpenApi.annotations({
      title: "Token",
      description: "Token issuance, revocation and introspection.",
    }),
  ) {}
