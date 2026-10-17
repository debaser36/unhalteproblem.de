import { Schema } from "effect";

/**
 * Error codes defined by the specs this library models:
 *
 * - token endpoint: RFC 6749 §5.2
 * - authorization endpoint: RFC 6749 §4.1.2.1 and OIDC Core §3.1.2.6
 * - bearer-protected resources such as userinfo: RFC 6750 §3.1
 * - revocation: RFC 7009 §2.2.1
 */
export const KnownOAuthErrorCode = Schema.Literals([
  // RFC 6749
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_response_type",
  "invalid_scope",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
  // OIDC Core §3.1.2.6
  "interaction_required",
  "login_required",
  "account_selection_required",
  "consent_required",
  "invalid_request_uri",
  "invalid_request_object",
  "request_not_supported",
  "request_uri_not_supported",
  "registration_not_supported",
  // RFC 6750
  "invalid_token",
  "insufficient_scope",
  // RFC 7009
  "unsupported_token_type",
]);
export type KnownOAuthErrorCode = typeof KnownOAuthErrorCode.Type;

/**
 * The `error` code of an OAuth error response. Providers may add codes of
 * their own, so any string is accepted; compare against
 * `KnownOAuthErrorCode` values.
 */
export const OAuthErrorCode = Schema.Union([
  KnownOAuthErrorCode,
  Schema.String,
]).annotate({ description: "An OAuth 2.0 error code." });

/**
 * The fields of an OAuth error response body (RFC 6749 §5.2). Shared by the
 * error classes below and by the error redirect of the authorization
 * endpoint.
 */
export const oauthErrorFields = {
  error: OAuthErrorCode,
  /** Human-readable explanation for developers; never show it to end users. */
  error_description: Schema.optionalKey(Schema.String),
  error_uri: Schema.optionalKey(Schema.String),
};

// OAuth error bodies carry no discriminator. `Schema.tagDefaultOmit` fills
// in `_tag` while decoding and leaves it out when encoding, so the classes
// can be matched with `Effect.catchTag` while the wire format stays exactly
// RFC 6749 §5.2. The client picks the class by HTTP status.

/**
 * An OAuth error answered with 400 Bad Request: an invalid or unsupported
 * request, grant or scope, e.g. `invalid_grant` for an expired code or
 * refresh token.
 */
export class OAuthBadRequest extends Schema.Error<
  OAuthBadRequest,
  { readonly brand: unique symbol }
>("OAuthBadRequest")(
  { _tag: Schema.tagDefaultOmit("OAuthBadRequest"), ...oauthErrorFields },
  {
    httpApiStatus: 400,
    description: "The request was rejected (RFC 6749 §5.2).",
  },
) {}

/**
 * An OAuth error answered with 401 Unauthorized: client authentication
 * failed (`invalid_client`) or the bearer token is missing, invalid or
 * expired (`invalid_token`).
 */
export class OAuthUnauthorized extends Schema.Error<
  OAuthUnauthorized,
  { readonly brand: unique symbol }
>("OAuthUnauthorized")(
  { _tag: Schema.tagDefaultOmit("OAuthUnauthorized"), ...oauthErrorFields },
  {
    httpApiStatus: 401,
    description: "Client or bearer token authentication failed.",
  },
) {}

/**
 * An OAuth error answered with 403 Forbidden: the bearer token lacks the
 * required scope (`insufficient_scope`, RFC 6750 §3.1).
 */
export class OAuthForbidden extends Schema.Error<
  OAuthForbidden,
  { readonly brand: unique symbol }
>("OAuthForbidden")(
  { _tag: Schema.tagDefaultOmit("OAuthForbidden"), ...oauthErrorFields },
  {
    httpApiStatus: 403,
    description: "The bearer token does not grant access (RFC 6750 §3.1).",
  },
) {}
