import { IdToken, LogoutToken } from "#domain/Credentials";
import { Jwt } from "#domain/Jose";
import {
  AbsoluteUrl,
  Audience,
  Locales,
  NumericDate,
} from "#domain/Primitives";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

// RP-Initiated Logout 1.0: the client sends the user agent to the provider's
// end_session_endpoint and gets it back at its post_logout_redirect_uri.

/**
 * Query parameters of the end-session request (RP-Initiated Logout 1.0 §2).
 *
 * A `post_logout_redirect_uri` is only honoured together with
 * `id_token_hint` or `client_id` (§3); Keycloak rejects the request
 * otherwise, so this schema does too. It must be registered for the client
 * ("Valid post logout redirect URIs" in Keycloak).
 */
export const EndSessionRequest = Schema.Struct({
  /** The ID token from the login; lets Keycloak skip the logout confirmation. */
  id_token_hint: Schema.optionalKey(IdToken),
  logout_hint: Schema.optionalKey(Schema.String),
  client_id: Schema.optionalKey(Schema.NonEmptyString),
  post_logout_redirect_uri: Schema.optionalKey(AbsoluteUrl),
  /** Returned unchanged to the `post_logout_redirect_uri`. */
  state: Schema.optionalKey(Schema.NonEmptyString),
  ui_locales: Schema.optionalKey(Locales),
})
  .check(
    Schema.makeFilter(
      (request: {
        readonly post_logout_redirect_uri?: string;
        readonly id_token_hint?: unknown;
        readonly client_id?: string;
      }) =>
        request.post_logout_redirect_uri === undefined ||
        request.id_token_hint !== undefined ||
        request.client_id !== undefined
          ? undefined
          : "post_logout_redirect_uri requires id_token_hint or client_id",
    ),
  )
  .annotate({ identifier: "EndSessionRequest" });
export type EndSessionRequest = typeof EndSessionRequest.Type;

/** Query parameters of the redirect to the `post_logout_redirect_uri` (§3). */
export const EndSessionCallback = Schema.Struct({
  state: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "EndSessionCallback" });
export type EndSessionCallback = typeof EndSessionCallback.Type;

// Back-Channel Logout 1.0: when a session ends at the provider (logout
// elsewhere, admin action, expiry), it POSTs a logout token to every client's
// registered back-channel logout URL. The endpoint receiving it belongs to
// our own API; these schemas describe its request and payload.

/** The `events` member that identifies a logout token (§2.4). */
export const BackchannelLogoutEvent =
  "http://schemas.openid.net/event/backchannel-logout";

/**
 * Claims of a logout token (Back-Channel Logout 1.0 §2.4). It names the
 * user (`sub`), the provider session (`sid`) or both; `nonce` is forbidden so
 * that an ID token cannot be passed off as a logout token.
 */
export const LogoutTokenClaims = Schema.StructWithRest(
  Schema.Struct({
    iss: Schema.String,
    aud: Audience,
    iat: NumericDate,
    exp: NumericDate,
    jti: Schema.NonEmptyString,
    sub: Schema.optionalKey(Schema.NonEmptyString),
    sid: Schema.optionalKey(Schema.NonEmptyString),
    events: Schema.Struct({
      [BackchannelLogoutEvent]: Schema.Struct({}),
    }),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
  .check(
    Schema.makeFilter(
      (claims: { readonly sub?: string; readonly sid?: string }) =>
        claims.sub !== undefined || claims.sid !== undefined
          ? undefined
          : "a logout token must contain sub, sid or both",
    ),
    Schema.makeFilter((claims: object) =>
      "nonce" in claims ? "a logout token must not contain nonce" : undefined,
    ),
  )
  .annotate({ identifier: "LogoutTokenClaims" });
export type LogoutTokenClaims = typeof LogoutTokenClaims.Type;

/**
 * A logout token, decoded but NOT verified. Keycloak sets the `typ` header
 * to `logout+jwt`. Validate it like an ID token (§2.6), then end the
 * matching local sessions.
 */
export const UnverifiedLogoutToken = Jwt(LogoutTokenClaims);
export type UnverifiedLogoutToken = typeof UnverifiedLogoutToken.Type;

/**
 * Form body the provider POSTs to the back-channel logout URL (§2.5).
 * Other parameters must be ignored, which decoding does.
 *
 * The receiving endpoint answers 200 (or 204) on success and 400 with an
 * `OAuthBadRequest` body otherwise, with `Cache-Control: no-store` (§2.8).
 */
export const BackchannelLogoutRequest = Schema.Struct({
  logout_token: LogoutToken,
})
  .annotate({ identifier: "BackchannelLogoutRequest" })
  .pipe(HttpApiSchema.asFormUrlEncoded());
export type BackchannelLogoutRequest = typeof BackchannelLogoutRequest.Type;
