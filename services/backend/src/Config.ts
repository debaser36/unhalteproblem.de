import {
  Config,
  ConfigProvider,
  Duration,
  Effect,
  Option,
  type Redacted,
  Schema,
} from "effect";

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
 * The Postgres database (sessions, users and the outbox). Set
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
  maxConnections: Config.schema(PositiveInt, "POSTGRES_MAX_CONNECTIONS").pipe(
    Config.withDefault(10),
  ),
  connectTimeout: Config.schema(
    PositiveDuration,
    "POSTGRES_CONNECT_TIMEOUT",
  ).pipe(Config.withDefault(Duration.seconds(5))),
  // Enforced by Postgres for every statement of this service, so a runaway
  // query can't hold a pooled connection forever. It applies to migrations
  // too: raise it for a deploy that runs a slow one.
  statementTimeout: Config.schema(
    PositiveDuration,
    "POSTGRES_STATEMENT_TIMEOUT",
  ).pipe(Config.withDefault(Duration.seconds(30))),
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

/** How long contact messages are kept before they are deleted. */
export const ContactRetentionConfig = Config.schema(
  PositiveDuration,
  "CONTACT_RETENTION",
).pipe(Config.withDefault(Duration.days(90)));

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

/** The SMTP server that sends the mails about contact messages. */
export interface MailSettings {
  readonly host: string;
  readonly port: number;
  /** `starttls` upgrades a plain connection (usually port 587); `tls` is TLS from the start (465); `none` is plain text and only for
   * a mail catcher on the same machine (Mailpit, MailHog). */
  readonly security: "starttls" | "tls" | "none";
  readonly auth: Option.Option<{
    readonly user: string;
    readonly password: Redacted.Redacted;
  }>;
  /** The envelope and header sender, e.g. `Website <noreply@unhalteproblem.de>`. */
  readonly from: string;
  /** Who gets the mails about contact messages. */
  readonly to: string;
}

/**
 * Optional: without `SMTP_HOST` contact messages are stored but not mailed.
 * With it, `SMTP_FROM` and `CONTACT_MAIL_TO` are required, and so is
 * `SMTP_PASSWORD` once `SMTP_USER` is set, so a half-finished setup fails
 * at startup instead of silently not mailing.
 */
export const MailConfig: Config.Config<Option.Option<MailSettings>> =
  Config.option(Config.NonEmptyString("SMTP_HOST")).pipe(
    Config.flatMap((host) =>
      Option.isNone(host)
        ? Config.succeed(Option.none<MailSettings>())
        : Config.all({
            host: Config.succeed(host.value),
            security: Config.Literals(
              ["starttls", "tls", "none"],
              "SMTP_SECURITY",
            ).pipe(Config.withDefault("starttls" as const)),
            auth: Config.option(Config.NonEmptyString("SMTP_USER")).pipe(
              Config.flatMap((user) =>
                Option.isNone(user)
                  ? Config.succeed(Option.none())
                  : Config.Redacted("SMTP_PASSWORD").pipe(
                      Config.map((password) =>
                        Option.some({ user: user.value, password }),
                      ),
                    ),
              ),
            ),
            from: Config.NonEmptyString("SMTP_FROM"),
            to: Config.NonEmptyString("CONTACT_MAIL_TO"),
          }).pipe(
            Config.flatMap((settings) =>
              Config.Port("SMTP_PORT").pipe(
                Config.withDefault(settings.security === "tls" ? 465 : 587),
                Config.mapEffect((port) =>
                  settings.security === "none" &&
                  !loopbackHosts.has(settings.host)
                    ? Effect.fail(
                        new Config.ConfigError(
                          new ConfigProvider.SourceError({
                            message:
                              "SMTP_SECURITY=none is only allowed for a mail server on this machine (localhost)",
                          }),
                        ),
                      )
                    : Effect.succeed<Option.Option<MailSettings>>(
                        Option.some({ ...settings, port }),
                      ),
                ),
              ),
            ),
          ),
    ),
  );
