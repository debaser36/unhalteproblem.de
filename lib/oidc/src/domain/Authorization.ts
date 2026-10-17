import { AuthorizationCode, IdToken } from "#domain/Credentials";
import {
  AbsoluteUrl,
  Locales,
  Scopes,
  Seconds,
  SpaceDelimited,
  Token,
} from "#domain/Primitives";
import { oauthErrorFields } from "#errors/OAuthError";
import { Schema } from "effect";

// The authorization endpoint (OIDC Core §3.1.2) with PKCE (RFC 7636). The
// user agent is sent there with an `AuthorizationRequest` in the query and
// comes back to the client's `redirect_uri` with an `AuthorizationCallback`.

const pkceCharset = /^[A-Za-z0-9\-._~]{43,128}$/u;

/**
 * PKCE `code_verifier` (RFC 7636 §4.1): 43 to 128 unreserved characters,
 * i.e. at least 256 bits of entropy when generated as recommended. It is a
 * per-login secret and only ever sent to the token endpoint.
 */
export const CodeVerifier = Schema.RedactedFromValue(
  Schema.String.check(
    Schema.isPattern(pkceCharset, { expected: "a PKCE code verifier" }),
  ).pipe(Schema.brand("CodeVerifier")),
).annotate({ description: "PKCE code verifier (RFC 7636 §4.1)." });

/**
 * PKCE `code_challenge` (RFC 7636 §4.2). With `S256` it is the unpadded
 * base64url SHA-256 of the verifier, which is always 43 characters.
 */
export const CodeChallenge = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9\-_]{43}$/u, {
    expected: "a base64url-encoded SHA-256 code challenge",
  }),
);

/**
 * Only `S256`: the OAuth security BCP (RFC 9700 §2.1.1) rules out `plain`
 * when S256 is available, and Keycloak supports it.
 */
export const CodeChallengeMethod = Schema.Literal("S256");

/** How the authorization response is returned (OAuth 2.0 Multiple Response Types, Form Post Response Mode). */
export const ResponseMode = Schema.Literals(["query", "fragment", "form_post"]);

/** How the provider displays its UI (OIDC Core §3.1.2.1). */
export const Display = Schema.Literals(["page", "popup", "touch", "wap"]);

/**
 * `prompt` values (OIDC Core §3.1.2.1, plus `create` from Initiating User
 * Registration via OpenID Connect 1.0, which Keycloak supports to open the
 * registration form).
 */
export const PromptValue = Schema.Literals([
  "none",
  "login",
  "consent",
  "select_account",
  "create",
]);
export type PromptValue = typeof PromptValue.Type;

/** The authentication request must ask for the `openid` scope (OIDC Core §3.1.2.1). */
export const OpenIdScopes = Scopes.check(
  Schema.makeFilter((scopes: ReadonlyArray<string>) =>
    scopes.includes("openid") ? undefined : 'scope must include "openid"',
  ),
);

/**
 * Query parameters of the authentication request (OIDC Core §3.1.2.1) for
 * the authorization code flow with PKCE.
 *
 * Stricter than the spec on purpose: `state`, `nonce` and the PKCE challenge
 * are optional there but required here, because together they protect
 * against CSRF, code injection and token replay (RFC 9700 §2.1, OIDC Core
 * §15.5.2). `request`, `request_uri` (JAR/PAR) and the `claims` parameter
 * are not modelled.
 */
export const AuthorizationRequest = Schema.Struct({
  response_type: Schema.Literal("code"),
  client_id: Schema.NonEmptyString,
  /** Must exactly match a redirect URI registered for the client. */
  redirect_uri: AbsoluteUrl,
  scope: OpenIdScopes,
  /** Opaque value bound to the user agent's session; returned unchanged. */
  state: Schema.NonEmptyString,
  /** Bound to the session; must come back as the ID token's `nonce` claim. */
  nonce: Schema.NonEmptyString,
  code_challenge: CodeChallenge,
  code_challenge_method: CodeChallengeMethod,
  response_mode: Schema.optionalKey(ResponseMode),
  display: Schema.optionalKey(Display),
  prompt: Schema.optionalKey(SpaceDelimited(PromptValue)),
  /** Maximum age of the user's authentication in seconds; forces re-login if older. */
  max_age: Schema.optionalKey(Seconds),
  ui_locales: Schema.optionalKey(Locales),
  claims_locales: Schema.optionalKey(Locales),
  /** A previously issued ID token, as a hint about the current session. */
  id_token_hint: Schema.optionalKey(IdToken),
  /** Pre-fills the username or e-mail on the login form. */
  login_hint: Schema.optionalKey(Schema.String),
  acr_values: Schema.optionalKey(SpaceDelimited(Token)),
}).annotate({
  identifier: "AuthorizationRequest",
  description: "OpenID Connect authentication request (code flow with PKCE).",
});
export type AuthorizationRequest = typeof AuthorizationRequest.Type;

/**
 * Successful authorization response at the client's `redirect_uri` (OIDC
 * Core §3.1.2.5).
 */
export const AuthorizationResponse = Schema.Struct({
  /** One-time authorization code, exchanged at the token endpoint. */
  code: AuthorizationCode,
  state: Schema.NonEmptyString,
  /**
   * The issuer (RFC 9207), a defence against mix-up attacks. Keycloak
   * advertises `authorization_response_iss_parameter_supported`, so it
   * must be present and equal the expected issuer (RFC 9207 §2.4).
   */
  iss: Schema.optionalKey(AbsoluteUrl),
  /** OP session state, for OIDC Session Management. */
  session_state: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "AuthorizationResponse" });
export type AuthorizationResponse = typeof AuthorizationResponse.Type;

/**
 * Error response at the client's `redirect_uri` (RFC 6749 §4.1.2.1, OIDC
 * Core §3.1.2.6), e.g. `access_denied` when the user cancels, or
 * `login_required` for `prompt=none` without a session.
 */
export const AuthorizationErrorResponse = Schema.Struct({
  ...oauthErrorFields,
  /** Present whenever the request contained `state`. */
  state: Schema.optionalKey(Schema.String),
  iss: Schema.optionalKey(AbsoluteUrl),
}).annotate({ identifier: "AuthorizationErrorResponse" });
export type AuthorizationErrorResponse = typeof AuthorizationErrorResponse.Type;

/**
 * Query parameters of the request to the client's `redirect_uri`: either an
 * error or a code. The error member comes first, so a response carrying both
 * `error` and `code` is treated as an error.
 */
export const AuthorizationCallback = Schema.Union([
  AuthorizationErrorResponse,
  AuthorizationResponse,
]).annotate({ identifier: "AuthorizationCallback" });
export type AuthorizationCallback = typeof AuthorizationCallback.Type;
