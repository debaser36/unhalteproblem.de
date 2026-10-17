import { Config, Duration, Option, Schema } from "effect";

/**
 * The HTTP listener. The default host only accepts local connections; the
 * container sets `HOST=0.0.0.0` and is itself published on 127.0.0.1 only,
 * behind nginx.
 */
export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1")),
});

/** `pretty` for development, `json` for the container's log collector. */
export const LogFormat = Config.Literals(["pretty", "json"], "LOG_FORMAT").pipe(
  Config.withDefault("pretty"),
);

// A zero limit would reject every message and a zero window would disable
// the limiter, so both must be positive; a typo fails at startup instead.
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const PositiveDuration = Schema.DurationFromString.check(
  Schema.makeFilter(
    (duration) =>
      Duration.isGreaterThan(duration, Duration.zero) ||
      "must be longer than zero",
  ),
);

/**
 * How many contact messages one client, and all clients together, may send
 * per window. The global limit bounds log volume however many addresses a
 * sender rotates through.
 */
export const ContactRateLimitConfig = Config.all({
  limit: Config.schema(PositiveInt, "CONTACT_RATE_LIMIT").pipe(
    Config.withDefault(5),
  ),
  globalLimit: Config.schema(PositiveInt, "CONTACT_RATE_LIMIT_GLOBAL").pipe(
    Config.withDefault(100),
  ),
  window: Config.schema(PositiveDuration, "CONTACT_RATE_LIMIT_WINDOW").pipe(
    Config.withDefault(Duration.hours(1)),
  ),
});

/**
 * The Postgres database (sessions and login state). Set
 * `POSTGRES_PASSWORD` through an environment file, never in the Nix store.
 */
export const DatabaseConfig = Config.all({
  host: Config.String("POSTGRES_HOST").pipe(Config.withDefault("localhost")),
  port: Config.Port("POSTGRES_PORT").pipe(Config.withDefault(5432)),
  database: Config.NonEmptyString("POSTGRES_DB").pipe(
    Config.withDefault("unhalteproblem"),
  ),
  username: Config.NonEmptyString("POSTGRES_USER").pipe(
    Config.withDefault("unhalteproblem"),
  ),
  // Optional: local setups often authenticate without one (trust, peer).
  password: Config.Redacted("POSTGRES_PASSWORD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

// Absolute http(s) URL without query or fragment, kept as a string because
// OIDC compares issuers and redirect URIs as exact strings.
const BaseUrl = Schema.String.check(
  Schema.makeFilter((s: string) => {
    if (!URL.canParse(s)) return "must be an absolute URL";
    const url = new URL(s);
    // Plain http only for local development: the issuer receives the client
    // secret, and the session cookies require a secure context.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return "must be an https URL (http only for localhost)";
    }
    if (url.search !== "" || url.hash !== "") {
      return "must not have a query or fragment";
    }
    if (s.endsWith("/")) return "must not end with a slash";
    return undefined;
  }),
);

/**
 * The OpenID Provider (Keycloak) and this backend's client there. The
 * issuer is the realm URL exactly as Keycloak reports it in its discovery
 * document and in the `iss` claim of its tokens.
 */
export const OidcConfig = Config.all({
  issuer: Config.schema(BaseUrl, "OIDC_ISSUER").pipe(
    Config.withDefault(
      "https://auth.unhalteproblem.de/realms/unhalteproblem-main",
    ),
  ),
  clientId: Config.NonEmptyString("OIDC_CLIENT_ID").pipe(
    Config.withDefault("unhalteproblem-backend"),
  ),
  clientSecret: Config.Redacted("OIDC_CLIENT_SECRET"),
});

/**
 * Where the website and this backend are reachable from browsers. The API
 * URL is the backend behind nginx's `/api/` prefix; the login callback is
 * `<PUBLIC_API_URL>/auth/callback`.
 */
export const PublicUrlConfig = Config.all({
  origin: Config.schema(
    BaseUrl.check(
      Schema.makeFilter((s: string) =>
        new URL(s).origin === s ? undefined : "must be an origin (no path)",
      ),
    ),
    "PUBLIC_ORIGIN",
  ).pipe(Config.withDefault("https://unhalteproblem.de")),
  apiUrl: Config.schema(BaseUrl, "PUBLIC_API_URL").pipe(Config.option),
}).pipe(
  Config.map(({ origin, apiUrl }) => ({
    origin,
    apiUrl: Option.getOrElse(apiUrl, () => `${origin}/api`),
  })),
);

/** How long a login session lasts before the user has to sign in again. */
export const SessionConfig = Config.all({
  maxAge: Config.schema(PositiveDuration, "SESSION_MAX_AGE").pipe(
    Config.withDefault(Duration.hours(8)),
  ),
});
