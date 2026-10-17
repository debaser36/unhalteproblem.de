import { AbsoluteUrl } from "#domain/Primitives";
import { Schema } from "effect";

const Strings = Schema.Array(Schema.String);
const optionalStrings = Schema.optionalKey(Strings);
const optionalUrl = Schema.optionalKey(AbsoluteUrl);
const optionalBoolean = Schema.optionalKey(Schema.Boolean);

/**
 * OpenID Provider Metadata, served at `/.well-known/openid-configuration`
 * below the issuer.
 *
 * Covers OpenID Connect Discovery 1.0 §3 plus the metadata defined by the
 * other specs this library models: OAuth 2.0 Authorization Server Metadata
 * (RFC 8414, revocation, introspection and PKCE), RFC 9207 (`iss` in the
 * authorization response), RP-Initiated Logout 1.0 and Back-Channel Logout
 * 1.0. Fields not listed here, Keycloak's extras included, are dropped while
 * decoding.
 *
 * `token_endpoint` is required here although Discovery makes it optional for
 * providers that only support the implicit flow; this library uses the code
 * flow exclusively.
 */
export const ProviderMetadata = Schema.Struct({
  // OpenID Connect Discovery 1.0 §3
  /**
   * The issuer identifier. Must equal the configured issuer exactly
   * (Discovery §4.3) and the `iss` claim of every token.
   */
  issuer: AbsoluteUrl,
  authorization_endpoint: AbsoluteUrl,
  token_endpoint: AbsoluteUrl,
  userinfo_endpoint: optionalUrl,
  jwks_uri: AbsoluteUrl,
  registration_endpoint: optionalUrl,
  scopes_supported: optionalStrings,
  response_types_supported: Strings,
  response_modes_supported: optionalStrings,
  grant_types_supported: optionalStrings,
  acr_values_supported: optionalStrings,
  subject_types_supported: Strings,
  id_token_signing_alg_values_supported: Strings,
  id_token_encryption_alg_values_supported: optionalStrings,
  id_token_encryption_enc_values_supported: optionalStrings,
  userinfo_signing_alg_values_supported: optionalStrings,
  userinfo_encryption_alg_values_supported: optionalStrings,
  userinfo_encryption_enc_values_supported: optionalStrings,
  request_object_signing_alg_values_supported: optionalStrings,
  request_object_encryption_alg_values_supported: optionalStrings,
  request_object_encryption_enc_values_supported: optionalStrings,
  token_endpoint_auth_methods_supported: optionalStrings,
  token_endpoint_auth_signing_alg_values_supported: optionalStrings,
  display_values_supported: optionalStrings,
  claim_types_supported: optionalStrings,
  claims_supported: optionalStrings,
  service_documentation: optionalUrl,
  claims_locales_supported: optionalStrings,
  ui_locales_supported: optionalStrings,
  claims_parameter_supported: optionalBoolean,
  request_parameter_supported: optionalBoolean,
  request_uri_parameter_supported: optionalBoolean,
  require_request_uri_registration: optionalBoolean,
  op_policy_uri: optionalUrl,
  op_tos_uri: optionalUrl,

  // RFC 8414 §2: token revocation (RFC 7009) and introspection (RFC 7662)
  revocation_endpoint: optionalUrl,
  revocation_endpoint_auth_methods_supported: optionalStrings,
  revocation_endpoint_auth_signing_alg_values_supported: optionalStrings,
  introspection_endpoint: optionalUrl,
  introspection_endpoint_auth_methods_supported: optionalStrings,
  introspection_endpoint_auth_signing_alg_values_supported: optionalStrings,
  /** PKCE methods (RFC 7636); `S256` must be among them. */
  code_challenge_methods_supported: optionalStrings,

  // RFC 9207 §3
  authorization_response_iss_parameter_supported: optionalBoolean,

  // RP-Initiated Logout 1.0 §2.1
  end_session_endpoint: optionalUrl,

  // Back-Channel Logout 1.0 §2.1
  backchannel_logout_supported: optionalBoolean,
  backchannel_logout_session_supported: optionalBoolean,
}).annotate({
  identifier: "ProviderMetadata",
  description: "OpenID Provider Metadata (OpenID Connect Discovery 1.0).",
});
export type ProviderMetadata = typeof ProviderMetadata.Type;
