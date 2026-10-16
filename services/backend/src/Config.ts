import { Config, Duration, Schema } from "effect";

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
