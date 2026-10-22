import {
  type IdToken,
  IdTokenClaims,
  type LogoutToken,
  LogoutTokenClaims,
  OidcApi,
} from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import {
  createRemoteJWKSet,
  errors as JoseErrors,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { OidcConfig } from "#Config";

/** A token failed verification. `reason` is for logs, never for clients. */
export class InvalidToken extends Schema.TaggedError<
  InvalidToken,
  { readonly brand: unique symbol }
>()("InvalidToken", { reason: Schema.String }) {}

/**
 * The provider's keys could not be fetched (timeout, network, malformed JWK
 * Set), so the token could not be checked at all. Unlike `InvalidToken`
 * this is an operational problem, not a rejected token.
 */
export class KeysUnavailable extends Schema.TaggedError<
  KeysUnavailable,
  { readonly brand: unique symbol }
>()("KeysUnavailable", { reason: Schema.String }) {}

/** ID token claims whose signature and claims have been checked. */
export const VerifiedIdTokenClaims = IdTokenClaims.pipe(
  Schema.brand("VerifiedIdTokenClaims"),
);
export type VerifiedIdTokenClaims = typeof VerifiedIdTokenClaims.Type;

/** Logout token claims whose signature and claims have been checked. */
export const VerifiedLogoutTokenClaims = LogoutTokenClaims.pipe(
  Schema.brand("VerifiedLogoutTokenClaims"),
);
export type VerifiedLogoutTokenClaims = typeof VerifiedLogoutTokenClaims.Type;

interface Options {
  /** Expected `iss`, exactly as the provider reports it. */
  readonly issuer: string;
  /** This client's id, the expected audience. */
  readonly clientId: string;
  /** Source of verification keys: the provider's JWK Set. */
  readonly keys: JWTVerifyGetKey;
}

// Pinned to Keycloak's realm signing algorithm. Never taken from the token
// header alone, which is what rules out `none` and algorithm confusion
// (RFC 8725 §3.1); jose additionally requires the key to match.
const algorithms = ["RS256"];

/** Tolerated clock difference between Keycloak and this server. */
export const clockToleranceSeconds = 30;

// Both token kinds are only accepted fresh: an ID token right after the code
// exchange, a logout token right after the session ended at the provider.
const maxTokenAge = "10 minutes";

const toError = (error: unknown) =>
  error instanceof JoseErrors.JWKSTimeout ||
  error instanceof JoseErrors.JWKSInvalid ||
  !(error instanceof JoseErrors.JOSEError)
    ? new KeysUnavailable({ reason: String(error) })
    : new InvalidToken({ reason: `${error.code}: ${error.message}` });

// Schema messages quote the offending values, which may be personal data
// (e.g. `email`), so only a fixed reason is kept.
const invalidClaims = () =>
  new InvalidToken({ reason: "claims do not match the expected schema" });

const make = (options: Options) => {
  const verify = (token: string, span: string) =>
    Effect.tryPromise({
      try: () =>
        jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: options.clientId,
          algorithms,
          clockTolerance: clockToleranceSeconds,
          maxTokenAge,
          requiredClaims: ["iat", "exp"],
        }),
      catch: toError,
    }).pipe(Effect.withSpan(span));

  return TokenVerifier.of({
    verifyIdToken: Effect.fn("TokenVerifier.verifyIdToken")(function* (
      token: IdToken,
      expected: { readonly nonce: string },
    ) {
      const { payload } = yield* verify(Redacted.value(token), "jwtVerify");
      const claims = yield* Schema.decodeUnknownEffect(VerifiedIdTokenClaims)(
        payload,
      ).pipe(Effect.mapError(invalidClaims));
      // OIDC Core §3.1.3.7, the checks jose does not do itself.
      if (claims.nonce !== expected.nonce) {
        return yield* new InvalidToken({ reason: "nonce mismatch" });
      }
      if (claims.aud.length > 1 && claims.azp === undefined) {
        return yield* new InvalidToken({
          reason: "azp missing with multiple audiences",
        });
      }
      if (claims.azp !== undefined && claims.azp !== options.clientId) {
        return yield* new InvalidToken({ reason: "azp is another client" });
      }
      return claims;
    }),

    verifyLogoutToken: Effect.fn("TokenVerifier.verifyLogoutToken")(function* (
      token: LogoutToken,
    ) {
      // Back-Channel Logout 1.0 §2.6. The `typ` header is only RECOMMENDED
      // to be `logout+jwt`, so it is not required; the `events` claim and
      // the ban on `nonce` (checked by the schema) keep ID and access
      // tokens from passing as logout tokens.
      const { payload } = yield* verify(Redacted.value(token), "jwtVerify");
      return yield* Schema.decodeUnknownEffect(VerifiedLogoutTokenClaims)(
        payload,
      ).pipe(Effect.mapError(invalidClaims));
    }),
  });
};

/**
 * Verifies tokens issued by the OpenID Provider: signature against the
 * provider's JWK Set, then issuer, audience, lifetime and the
 * token-specific claims.
 */
export class TokenVerifier extends Context.Service<
  TokenVerifier,
  {
    readonly verifyIdToken: (
      token: IdToken,
      expected: { readonly nonce: string },
    ) => Effect.Effect<VerifiedIdTokenClaims, InvalidToken | KeysUnavailable>;
    readonly verifyLogoutToken: (
      token: LogoutToken,
    ) => Effect.Effect<
      VerifiedLogoutTokenClaims,
      InvalidToken | KeysUnavailable
    >;
  }
>()("@unhalteproblem.de/backend/TokenVerifier") {
  /**
   * Keys from the provider's JWK Set, fetched on first use and cached; an
   * unknown `kid` (key rotation) triggers a refetch, rate-limited by jose.
   */
  static readonly layer = Layer.effect(
    TokenVerifier,
    Effect.gen(function* () {
      const { issuer, clientId } = yield* OidcConfig;
      const jwksUrl = HttpApiClient.urlBuilder(OidcApi, {
        baseUrl: issuer,
      }).discovery.keys();
      return make({
        issuer,
        clientId,
        keys: createRemoteJWKSet(new URL(jwksUrl), {
          timeoutDuration: 5_000,
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000,
        }),
      });
    }),
  );

  /** With a fixed key source, for tests. */
  static readonly layerWith = (options: Options) =>
    Layer.succeed(TokenVerifier, make(options));
}
