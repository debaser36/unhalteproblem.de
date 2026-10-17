import { CodeVerifier } from "#domain/Authorization";
import {
  AccessToken,
  AuthorizationCode,
  ClientSecret,
  IdToken,
  RefreshToken,
  RevocableToken,
} from "#domain/Credentials";
import { AbsoluteUrl, Scopes, Seconds } from "#domain/Primitives";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

/**
 * Client authentication in the form body (RFC 6749 §2.3.1, OIDC Core §9),
 * shared by every endpoint that authenticates clients.
 *
 * - Public clients (the SPA) send only `client_id`.
 * - Confidential clients (the backend) either use `client_secret_basic`,
 *   i.e. the `ClientSecretBasic` middleware and none of these fields, or
 *   `client_secret_post`, i.e. both fields here.
 *
 * `client_secret_jwt` and `private_key_jwt` assertions are not modelled.
 */
export const clientAuthenticationFields = {
  client_id: Schema.optionalKey(Schema.NonEmptyString),
  client_secret: Schema.optionalKey(ClientSecret),
};

/**
 * Exchanges an authorization code (RFC 6749 §4.1.3, OIDC Core §3.1.3.1,
 * RFC 7636 §4.5). `redirect_uri` must be identical to the one in the
 * authorization request.
 */
export const AuthorizationCodeGrant = Schema.Struct({
  grant_type: Schema.Literal("authorization_code"),
  code: AuthorizationCode,
  redirect_uri: AbsoluteUrl,
  code_verifier: CodeVerifier,
  ...clientAuthenticationFields,
}).annotate({ identifier: "AuthorizationCodeGrant" });

/**
 * Refreshes tokens (RFC 6749 §6, OIDC Core §12). `scope` may only narrow the
 * original grant. Keycloak rotates refresh tokens by default, so always keep
 * the one from the response.
 */
export const RefreshTokenGrant = Schema.Struct({
  grant_type: Schema.Literal("refresh_token"),
  refresh_token: RefreshToken,
  scope: Schema.optionalKey(Scopes),
  ...clientAuthenticationFields,
}).annotate({ identifier: "RefreshTokenGrant" });

/**
 * Obtains a token for the client itself, without a user (RFC 6749 §4.4).
 * Confidential clients only; in Keycloak the client needs service accounts
 * enabled.
 */
export const ClientCredentialsGrant = Schema.Struct({
  grant_type: Schema.Literal("client_credentials"),
  scope: Schema.optionalKey(Scopes),
  ...clientAuthenticationFields,
}).annotate({ identifier: "ClientCredentialsGrant" });

/** Form body of a token request, distinguished by `grant_type`. */
export const TokenRequest = Schema.Union([
  AuthorizationCodeGrant,
  RefreshTokenGrant,
  ClientCredentialsGrant,
])
  .annotate({ identifier: "TokenRequest" })
  .pipe(HttpApiSchema.asFormUrlEncoded());
export type TokenRequest = typeof TokenRequest.Type;

/**
 * Successful token response (RFC 6749 §5.1, OIDC Core §3.1.3.3).
 *
 * `id_token` is present for the authorization code grant with the `openid`
 * scope, and usually also when refreshing such a grant; it is absent for
 * client credentials. Decode it with `UnverifiedIdToken`. Keycloak's extra fields
 * (`refresh_expires_in`, `not-before-policy`, `session_state`) are dropped.
 */
export const TokenResponse = Schema.Struct({
  access_token: AccessToken,
  /** `Bearer`, compared case-insensitively (RFC 6749 §7.1). */
  token_type: Schema.NonEmptyString,
  expires_in: Schema.optionalKey(Seconds),
  refresh_token: Schema.optionalKey(RefreshToken),
  /** The granted scope; RFC 6749 only requires it when it differs from the requested one. */
  scope: Schema.optionalKey(Scopes),
  /** Required for the authorization code grant: reject a login response without it. */
  id_token: Schema.optionalKey(IdToken),
}).annotate({
  identifier: "TokenResponse",
  description: "Tokens issued by the token endpoint.",
});
export type TokenResponse = typeof TokenResponse.Type;

/** Which kind of token a revocation or introspection request is about (RFC 7009 §2.1). */
export const TokenTypeHint = Schema.Literals(["access_token", "refresh_token"]);

/**
 * Form body of a revocation request (RFC 7009 §2.1). Revoking a Keycloak
 * refresh token ends the client's session (offline tokens included) and
 * revokes the user's consent for the client.
 */
export const RevocationRequest = Schema.Struct({
  token: RevocableToken,
  token_type_hint: Schema.optionalKey(TokenTypeHint),
  ...clientAuthenticationFields,
})
  .annotate({ identifier: "RevocationRequest" })
  .pipe(HttpApiSchema.asFormUrlEncoded());
export type RevocationRequest = typeof RevocationRequest.Type;

/**
 * Form body of an introspection request (RFC 7662 §2.1). Keycloak only
 * answers it for confidential clients.
 */
export const IntrospectionRequest = Schema.Struct({
  token: RevocableToken,
  token_type_hint: Schema.optionalKey(TokenTypeHint),
  ...clientAuthenticationFields,
})
  .annotate({ identifier: "IntrospectionRequest" })
  .pipe(HttpApiSchema.asFormUrlEncoded());
export type IntrospectionRequest = typeof IntrospectionRequest.Type;
