import { Schema, SchemaTransformation } from "effect";

/**
 * An absolute URL kept as a string, such as an endpoint or a redirect URI.
 *
 * Strings rather than `URL` instances: OAuth compares redirect URIs and
 * issuers by exact string match (RFC 6749 §3.1.2.2, OIDC Core §3.1.3.7), and
 * `URL` normalises (trailing slashes, case, default ports), which would hide
 * mismatches. The scheme is not restricted to `https` so that a local Keycloak
 * on `http://localhost` can be used in development.
 */
export const AbsoluteUrl = Schema.String.check(
  Schema.makeFilter((s: string) => URL.canParse(s), {
    expected: "an absolute URL",
  }),
).annotate({ format: "uri" });

/**
 * JWT `NumericDate` (RFC 7519 §2): seconds since the Unix epoch, possibly
 * fractional. Kept as a number so validation can compare it to a clock
 * without conversions.
 */
export const NumericDate = Schema.Finite.annotate({
  description: "Seconds since 1970-01-01T00:00:00Z (RFC 7519 NumericDate).",
});

/** A count of seconds, such as `expires_in` or `max_age`. */
export const Seconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The `aud` claim (RFC 7519 §4.1.3). On the wire it is either a single string
 * or an array of strings; it is always decoded into an array so that checks
 * like "contains my client id" work the same for both forms.
 */
export const Audience = Schema.ArrayEnsure(Schema.String).annotate({
  description: "One audience or a list of audiences.",
});

const spaceDelimited = SchemaTransformation.transform<
  ReadonlyArray<string>,
  string
>({
  // Lenient on decode (repeated or surrounding spaces are tolerated), strict
  // on encode (single spaces, as the ABNF in RFC 6749 §3.3 requires).
  decode: (s) => s.split(" ").filter((token) => token !== ""),
  encode: (tokens) => tokens.join(" "),
});

/**
 * A space-delimited list of tokens on the wire (`"openid email"`), decoded
 * into an array (`["openid", "email"]`). Used for `scope`, `prompt`,
 * `ui_locales`, `acr_values` and similar parameters.
 */
export const SpaceDelimited = <S extends Schema.Codec<string, string>>(
  token: S,
) => Schema.String.pipe(Schema.decodeTo(Schema.Array(token), spaceDelimited));

/** A space-free token of a space-delimited list. */
export const Token = Schema.String.check(
  Schema.isPattern(/^\S+$/u, { expected: "a non-empty token without spaces" }),
);

/**
 * One scope value: printable ASCII except space, `"` and `\`
 * (`scope-token` in RFC 6749 §3.3).
 */
export const ScopeToken = Schema.String.check(
  Schema.isPattern(/^[\x21\x23-\x5B\x5D-\x7E]+$/u, {
    expected: "a scope token",
  }),
);

/** A `scope` parameter, decoded into its individual scope values. */
export const Scopes = SpaceDelimited(ScopeToken).annotate({
  description: "Space-delimited scope values (RFC 6749 §3.3).",
});
export type Scopes = typeof Scopes.Type;

/** A space-delimited list of BCP 47 language tags (`ui_locales`, `claims_locales`). */
export const Locales = SpaceDelimited(Token).annotate({
  description: "Space-delimited BCP 47 language tags, most preferred first.",
});
