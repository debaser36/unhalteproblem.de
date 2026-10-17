import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

// JOSE: JSON Web Signature (RFC 7515), JSON Web Key (RFC 7517), JSON Web
// Algorithms (RFC 7518) and JSON Web Token (RFC 7519), as far as OpenID
// Connect needs them. Nothing here verifies signatures: these schemas only
// give the parts a shape, verification is up to the consumer.
//
// Rules for that verifier (RFC 8725, OIDC Core §3.1.3.7):
// - Take `alg` from an allow-list (e.g. RS256), never just from the header,
//   and require it to match the selected key's `kty` and `alg`; this rules
//   out `none` and RS256-to-HS256 confusion.
// - Select keys only from the provider's JWK Set by `kid`, with
//   `use: "sig"`. Never use keys referenced from the token itself (the
//   `jwk`, `jku`, `x5u` and `x5c` header parameters, kept as extensions).
// - Reject an empty signature.
// - Return a distinct (branded) type for verified tokens, so that code that
//   needs a verified token cannot be handed a merely decoded one.

const Extensions = [Schema.Record(Schema.String, Schema.Unknown)] as const;

/**
 * The protected header of a JWS (RFC 7515 §4.1).
 *
 * `alg` is not restricted here, not even `"none"`: rejecting unsigned or
 * unexpected algorithms is the job of token validation, which has to check
 * `alg` against the provider's advertised and the client's expected values
 * anyway. Unknown header parameters are kept.
 */
export const JoseHeader = Schema.StructWithRest(
  Schema.Struct({
    /** Signature algorithm, e.g. `RS256` (Keycloak's default) or `ES256`. */
    alg: Schema.NonEmptyString,
    /** Id of the signing key in the provider's JWK Set. */
    kid: Schema.optionalKey(Schema.String),
    /** Media type of the token, e.g. `JWT`, `at+jwt` or `logout+jwt`. */
    typ: Schema.optionalKey(Schema.String),
    /** Media type of the payload; only used for nested JWTs. */
    cty: Schema.optionalKey(Schema.String),
    /** Header parameters that must be understood (RFC 7515 §4.1.11). */
    crit: Schema.optionalKey(Schema.NonEmptyArray(Schema.String)),
  }),
  Extensions,
).annotate({ identifier: "JoseHeader" });
export type JoseHeader = typeof JoseHeader.Type;

/** A base64url-encoded JSON value (a JWT header or payload segment). */
const Base64UrlJson = <S extends Schema.Top>(schema: S) =>
  Schema.StringFromBase64Url.pipe(
    Schema.decodeTo(Schema.fromJsonString(schema)),
  );

const splitCompact = SchemaTransformation.transformEffect<
  {
    readonly header: string;
    readonly payload: string;
    readonly signingInput: string;
    readonly signature: string;
  },
  string
>({
  decode: (token, options) => {
    const parts = token.split(".");
    if (parts.length !== 3) {
      // Five parts would be an encrypted JWT (JWE), which is not supported.
      return Effect.fail(
        new SchemaIssue.InvalidValue(
          { expected: "a signed JWT in compact serialization (three parts)" },
          token,
          options,
        ),
      );
    }
    const [header, payload, signature] = parts as [string, string, string];
    return Effect.succeed({
      header,
      payload,
      signingInput: `${header}.${payload}`,
      signature,
    });
  },
  // `signingInput` holds the original header and payload segments. Encoding
  // reuses them, because re-serialising the decoded JSON would not reproduce
  // the signed bytes.
  encode: ({ signingInput, signature }) =>
    Effect.succeed(`${signingInput}.${signature}`),
});

/**
 * A signed JWT in JWS compact serialization (`header.payload.signature`),
 * decoded into its parts with `payload` decoded by the given claims schema.
 *
 * `signingInput` is the original `header.payload` text and `signature` the
 * raw signature bytes: together with a key from the JWK Set, exactly what
 * `crypto.subtle.verify` needs.
 *
 * Decoding a JWT does NOT verify it. Treat the decoded claims as untrusted
 * until the signature and the claims have been validated.
 */
export const Jwt = <S extends Schema.Top>(payload: S) =>
  Schema.String.pipe(
    Schema.decodeTo(
      Schema.Struct({
        header: Base64UrlJson(JoseHeader),
        payload: Base64UrlJson(payload),
        signingInput: Schema.String,
        signature: Schema.Uint8ArrayFromBase64Url,
      }),
      splitCompact,
    ),
  );

/** Key usage (RFC 7517 §4.2): signatures or encryption. */
export const JwkUse = Schema.Union([
  Schema.Literals(["sig", "enc"]),
  Schema.String,
]);

const jwkCommonFields = {
  /** Key type (RFC 7518 §6.1): `RSA`, `EC`, `OKP` (RFC 8037) or `oct`. */
  kty: Schema.NonEmptyString,
  use: Schema.optionalKey(JwkUse),
  key_ops: Schema.optionalKey(Schema.Array(Schema.String)),
  alg: Schema.optionalKey(Schema.String),
  kid: Schema.optionalKey(Schema.String),
  x5u: Schema.optionalKey(Schema.String),
  x5c: Schema.optionalKey(Schema.Array(Schema.String)),
  x5t: Schema.optionalKey(Schema.String),
  "x5t#S256": Schema.optionalKey(Schema.String),
};

/**
 * A JSON Web Key (RFC 7517 §4) as listed in a JWK Set: any JSON object.
 *
 * Deliberately unchecked: a JWK Set must still decode when it contains a key
 * of a type this library doesn't know, or one with missing or malformed
 * members, because RFC 7517 §5 says such keys are to be ignored rather than
 * rejecting the whole set. Decode candidates with `PublicJsonWebKey` and
 * skip those that fail.
 */
export const JsonWebKey = Schema.Record(Schema.String, Schema.Unknown).annotate(
  { identifier: "JsonWebKey" },
);
export type JsonWebKey = typeof JsonWebKey.Type;

/** An RSA public key (RFC 7518 §6.3.1). */
export const RsaPublicJwk = Schema.StructWithRest(
  Schema.Struct({
    ...jwkCommonFields,
    kty: Schema.Literal("RSA"),
    /** Modulus, base64url. */
    n: Schema.NonEmptyString,
    /** Exponent, base64url. */
    e: Schema.NonEmptyString,
  }),
  Extensions,
).annotate({ identifier: "RsaPublicJwk" });

/** An elliptic-curve public key (RFC 7518 §6.2.1). */
export const EcPublicJwk = Schema.StructWithRest(
  Schema.Struct({
    ...jwkCommonFields,
    kty: Schema.Literal("EC"),
    crv: Schema.Union([
      Schema.Literals(["P-256", "P-384", "P-521"]),
      Schema.String,
    ]),
    x: Schema.NonEmptyString,
    y: Schema.NonEmptyString,
  }),
  Extensions,
).annotate({ identifier: "EcPublicJwk" });

/** An octet key pair public key such as Ed25519 (RFC 8037 §2). */
export const OkpPublicJwk = Schema.StructWithRest(
  Schema.Struct({
    ...jwkCommonFields,
    kty: Schema.Literal("OKP"),
    crv: Schema.Union([
      Schema.Literals(["Ed25519", "Ed448", "X25519", "X448"]),
      Schema.String,
    ]),
    x: Schema.NonEmptyString,
  }),
  Extensions,
).annotate({ identifier: "OkpPublicJwk" });

/**
 * A public key of a type that can verify JWT signatures. Symmetric (`oct`)
 * keys are not included: a provider never publishes them.
 */
export const PublicJsonWebKey = Schema.Union([
  RsaPublicJwk,
  EcPublicJwk,
  OkpPublicJwk,
]).annotate({ identifier: "PublicJsonWebKey" });
export type PublicJsonWebKey = typeof PublicJsonWebKey.Type;

/**
 * A JWK Set (RFC 7517 §5), as served by the provider's `jwks_uri`
 * (Keycloak: `/protocol/openid-connect/certs`). Keycloak lists both signing
 * (`use: "sig"`) and encryption (`use: "enc"`) keys there.
 */
export const JsonWebKeySet = Schema.Struct({
  keys: Schema.Array(JsonWebKey),
}).annotate({ identifier: "JsonWebKeySet" });
export type JsonWebKeySet = typeof JsonWebKeySet.Type;
