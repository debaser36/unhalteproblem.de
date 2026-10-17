import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

// Credentials: tokens, codes and secrets. Each is decoded into `Redacted`, so
// it never shows up in logs, traces or error messages by accident, and each
// has its own brand, so one kind cannot be passed where another is expected
// (an access token as `id_token_hint` would end up in a browser URL). The
// wire format is the plain string, in JSON as well as in form or query
// encoding.
//
// Values arrive by decoding provider responses or incoming requests. To
// create one from a raw string, decode it: `Schema.decodeSync(IdToken)(raw)`.

/** An access token, opaque to clients (RFC 6749 §1.4). */
export const AccessToken = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("AccessToken")),
).annotate({ description: "An OAuth 2.0 access token." });
export type AccessToken = typeof AccessToken.Type;

/** A refresh token (RFC 6749 §1.5). Only ever sent to the token endpoint. */
export const RefreshToken = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("RefreshToken")),
).annotate({ description: "An OAuth 2.0 refresh token." });
export type RefreshToken = typeof RefreshToken.Type;

/**
 * An ID token in compact serialization (OIDC Core §2). Decode its parts
 * with `UnverifiedIdToken`.
 */
export const IdToken = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("IdToken")),
).annotate({ description: "An OpenID Connect ID token." });
export type IdToken = typeof IdToken.Type;

/**
 * A logout token in compact serialization (Back-Channel Logout 1.0 §2.4).
 * Decode its parts with `UnverifiedLogoutToken`.
 */
export const LogoutToken = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("LogoutToken")),
).annotate({ description: "A back-channel logout token." });
export type LogoutToken = typeof LogoutToken.Type;

/** A one-time authorization code (RFC 6749 §1.3.1). */
export const AuthorizationCode = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("AuthorizationCode")),
).annotate({ description: "An OAuth 2.0 authorization code." });
export type AuthorizationCode = typeof AuthorizationCode.Type;

/** A confidential client's secret (RFC 6749 §2.3.1). */
export const ClientSecret = Schema.RedactedFromValue(
  Schema.NonEmptyString.pipe(Schema.brand("ClientSecret")),
).annotate({ description: "An OAuth 2.0 client secret." });
export type ClientSecret = typeof ClientSecret.Type;

/** A token that can be revoked or introspected (RFC 7009 §2.1, RFC 7662 §2.1). */
export const RevocableToken = Schema.Union([AccessToken, RefreshToken]);
export type RevocableToken = typeof RevocableToken.Type;

const bearerPrefix = /^Bearer +/iu;

/**
 * An `Authorization: Bearer <token>` header value (RFC 6750 §2.1), decoded
 * into the access token alone. The scheme name is matched case-insensitively.
 */
export const BearerAuthorization = Schema.String.pipe(
  Schema.decodeTo(
    AccessToken,
    SchemaTransformation.transformEffect({
      decode: (header: string, options) =>
        bearerPrefix.test(header)
          ? Effect.succeed(header.replace(bearerPrefix, ""))
          : Effect.fail(
              new SchemaIssue.InvalidValue(
                { expected: "a Bearer authorization header" },
                header,
                options,
              ),
            ),
      encode: (token: string) => Effect.succeed(`Bearer ${token}`),
    }),
  ),
).annotate({ description: "Bearer token authorization (RFC 6750 §2.1)." });
