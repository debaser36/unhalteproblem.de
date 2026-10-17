import { Jwt } from "#domain/Jose";
import { Audience, NumericDate, Scopes } from "#domain/Primitives";
import { Schema } from "effect";

// Claims of ID tokens, access tokens, userinfo and introspection responses.
//
// All of them keep claims that aren't listed (`[claim: string]: unknown`):
// Keycloak adds its own (`realm_access`, `resource_access`, `typ`, custom
// mapper claims), and authorization will need them later. Unknown claims
// must be ignored, not rejected (OIDC Core §5.1, RFC 7519 §4).

const Extensions = [Schema.Record(Schema.String, Schema.Unknown)] as const;

/** A postal address (OIDC Core §5.1.1). */
export const Address = Schema.Struct({
  formatted: Schema.optionalKey(Schema.String),
  street_address: Schema.optionalKey(Schema.String),
  locality: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(Schema.String),
  postal_code: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Address" });

/**
 * The standard claims about the user (OIDC Core §5.1), except `sub`. Which
 * of them are present depends on the requested scopes (`profile`, `email`,
 * `address`, `phone`) and Keycloak's mappers.
 */
export const standardClaimFields = {
  name: Schema.optionalKey(Schema.String),
  given_name: Schema.optionalKey(Schema.String),
  family_name: Schema.optionalKey(Schema.String),
  middle_name: Schema.optionalKey(Schema.String),
  nickname: Schema.optionalKey(Schema.String),
  /** Not unique and not stable; identify users by `iss` + `sub` only. */
  preferred_username: Schema.optionalKey(Schema.String),
  profile: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(Schema.String),
  website: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  email_verified: Schema.optionalKey(Schema.Boolean),
  gender: Schema.optionalKey(Schema.String),
  /** `YYYY-MM-DD`, `0000-MM-DD` or `YYYY`. */
  birthdate: Schema.optionalKey(Schema.String),
  zoneinfo: Schema.optionalKey(Schema.String),
  locale: Schema.optionalKey(Schema.String),
  phone_number: Schema.optionalKey(Schema.String),
  phone_number_verified: Schema.optionalKey(Schema.Boolean),
  address: Schema.optionalKey(Address),
  updated_at: Schema.optionalKey(NumericDate),
};

/**
 * Subject identifier: locally unique and never reassigned within the issuer
 * (OIDC Core §2). In Keycloak, the user id.
 */
export const Subject = Schema.NonEmptyString.check(Schema.isMaxLength(255));

/** Claims of an ID token (OIDC Core §2, §3.1.3.6; `sid` from Front-/Back-Channel Logout). */
export const IdTokenClaims = Schema.StructWithRest(
  Schema.Struct({
    iss: Schema.String,
    sub: Subject,
    aud: Audience,
    exp: NumericDate,
    iat: NumericDate,
    auth_time: Schema.optionalKey(NumericDate),
    /**
     * Optional in general, but `AuthorizationRequest` always sends a nonce,
     * so an ID token from a login must carry it: reject it when missing.
     */
    nonce: Schema.optionalKey(Schema.String),
    acr: Schema.optionalKey(Schema.String),
    amr: Schema.optionalKey(Schema.Array(Schema.String)),
    /** Authorized party: the client the token was issued to. */
    azp: Schema.optionalKey(Schema.String),
    at_hash: Schema.optionalKey(Schema.String),
    c_hash: Schema.optionalKey(Schema.String),
    /** Provider session id, matched against back-channel logout tokens. */
    sid: Schema.optionalKey(Schema.String),
    ...standardClaimFields,
  }),
  Extensions,
).annotate({ identifier: "IdTokenClaims" });
export type IdTokenClaims = typeof IdTokenClaims.Type;

/** An ID token as returned by the token endpoint, decoded but NOT verified. */
export const UnverifiedIdToken = Jwt(IdTokenClaims);
export type UnverifiedIdToken = typeof UnverifiedIdToken.Type;

/**
 * Claims of a JWT access token, following the JWT profile for access tokens
 * (RFC 9068 §2.2) where Keycloak does.
 *
 * Deviations, because Keycloak does not send these by default: `aud` is
 * optional (it is only set when an audience is mapped into the token), and
 * `client_id` is optional (Keycloak names the client in `azp`); `jti` is
 * optional as well. Keycloak's `typ` header is `JWT`, not `at+jwt`.
 *
 * A resource server must still require an audience: map one into the
 * tokens in Keycloak (audience mapper) and reject tokens without it.
 * Accepting a missing `aud` would accept tokens issued for any client of
 * the realm.
 *
 * Only for resource servers, i.e. the backend validating a bearer token sent
 * by the SPA. A client must treat access tokens as opaque.
 */
export const AccessTokenClaims = Schema.StructWithRest(
  Schema.Struct({
    iss: Schema.String,
    sub: Subject,
    exp: NumericDate,
    iat: NumericDate,
    aud: Schema.optionalKey(Audience),
    client_id: Schema.optionalKey(Schema.String),
    azp: Schema.optionalKey(Schema.String),
    jti: Schema.optionalKey(Schema.String),
    scope: Schema.optionalKey(Scopes),
    auth_time: Schema.optionalKey(NumericDate),
    acr: Schema.optionalKey(Schema.String),
    amr: Schema.optionalKey(Schema.Array(Schema.String)),
    sid: Schema.optionalKey(Schema.String),
  }),
  Extensions,
).annotate({ identifier: "AccessTokenClaims" });
export type AccessTokenClaims = typeof AccessTokenClaims.Type;

/** A JWT access token, decoded but NOT verified. */
export const UnverifiedAccessToken = Jwt(AccessTokenClaims);
export type UnverifiedAccessToken = typeof UnverifiedAccessToken.Type;

/**
 * The userinfo response (OIDC Core §5.3.2). Its `sub` must equal the ID
 * token's `sub` before any of the other claims may be used.
 */
export const UserInfo = Schema.StructWithRest(
  Schema.Struct({ sub: Subject, ...standardClaimFields }),
  Extensions,
).annotate({ identifier: "UserInfo" });
export type UserInfo = typeof UserInfo.Type;

/**
 * A signed userinfo response (`application/jwt`), sent instead of JSON when
 * the client is configured for signed userinfo. Its claims then also carry
 * `iss` and `aud`, which arrive as extra claims.
 */
export const SignedUserInfo = Jwt(UserInfo);
export type SignedUserInfo = typeof SignedUserInfo.Type;

/**
 * An introspection response (RFC 7662 §2.2). For an inactive (expired,
 * revoked or unknown) token it is just `{ active: false }`. For an active
 * one Keycloak adds the token's claims, which are kept as extra claims.
 */
export const IntrospectionResponse = Schema.StructWithRest(
  Schema.Struct({
    active: Schema.Boolean,
    scope: Schema.optionalKey(Scopes),
    client_id: Schema.optionalKey(Schema.String),
    username: Schema.optionalKey(Schema.String),
    token_type: Schema.optionalKey(Schema.String),
    exp: Schema.optionalKey(NumericDate),
    iat: Schema.optionalKey(NumericDate),
    nbf: Schema.optionalKey(NumericDate),
    sub: Schema.optionalKey(Schema.String),
    aud: Schema.optionalKey(Audience),
    iss: Schema.optionalKey(Schema.String),
    jti: Schema.optionalKey(Schema.String),
  }),
  Extensions,
).annotate({ identifier: "IntrospectionResponse" });
export type IntrospectionResponse = typeof IntrospectionResponse.Type;
