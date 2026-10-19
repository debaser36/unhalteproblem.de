import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Exit, Option } from "effect";
import {
  ContactRetentionConfig,
  DatabaseConfig,
  KeycloakAdminConfig,
  MailConfig,
  OidcConfig,
  PublicUrlConfig,
} from "./Config.ts";

const load = <A, E>(config: Effect.Effect<A, E>, env: Record<string, string>) =>
  config.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    Effect.exit,
  );

describe("OidcConfig", () => {
  const secret = { OIDC_CLIENT_SECRET: "s3cret" };

  it.effect("defaults to the unhalteproblem-main realm", () =>
    Effect.gen(function* () {
      const exit = yield* load(OidcConfig, secret);
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.strictEqual(
          exit.value.issuer,
          "https://auth.unhalteproblem.de/realms/unhalteproblem-main",
        );
      }
    }),
  );

  it.effect.each([
    "http://auth.example.org/realms/x",
    "https://auth.example.org/realms/x/",
    "https://auth.example.org/realms/x?a=b",
    "auth.example.org",
  ])("rejects OIDC_ISSUER=%s", (issuer) =>
    Effect.gen(function* () {
      const exit = yield* load(OidcConfig, { ...secret, OIDC_ISSUER: issuer });
      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it.effect("accepts plain http for a local Keycloak", () =>
    Effect.gen(function* () {
      const exit = yield* load(OidcConfig, {
        ...secret,
        OIDC_ISSUER: "http://localhost:8080/realms/dev",
      });
      assert.isTrue(Exit.isSuccess(exit));
    }),
  );

  it.effect("requires the client secret", () =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isFailure(yield* load(OidcConfig, {})));
    }),
  );
});

describe("PublicUrlConfig", () => {
  it.effect("derives the API URL from the origin", () =>
    Effect.gen(function* () {
      const exit = yield* load(PublicUrlConfig, {
        PUBLIC_ORIGIN: "http://localhost:5173",
      });
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.deepStrictEqual(exit.value, {
          origin: "http://localhost:5173",
          apiUrl: "http://localhost:5173/api",
        });
      }
    }),
  );

  it.effect("rejects an origin with a path", () =>
    Effect.gen(function* () {
      const exit = yield* load(PublicUrlConfig, {
        PUBLIC_ORIGIN: "https://unhalteproblem.de/blog",
      });
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});

describe("DatabaseConfig", () => {
  it.effect("has working defaults", () =>
    Effect.gen(function* () {
      const exit = yield* load(DatabaseConfig, {});
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.strictEqual(exit.value.maxConnections, 10);
        assert.strictEqual(
          Duration.toMillis(exit.value.statementTimeout),
          30_000,
        );
        assert.strictEqual(Duration.toMillis(exit.value.connectTimeout), 5_000);
      }
    }),
  );

  it.effect.each([
    { POSTGRES_MAX_CONNECTIONS: "0" },
    { POSTGRES_MAX_CONNECTIONS: "many" },
    { POSTGRES_STATEMENT_TIMEOUT: "0 seconds" },
    { POSTGRES_CONNECT_TIMEOUT: "soon" },
  ])("rejects %o", (env) =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isFailure(yield* load(DatabaseConfig, env)));
    }),
  );
});

describe("MailConfig", () => {
  const smtp = {
    SMTP_HOST: "mail.example.org",
    SMTP_FROM: "noreply@example.org",
    CONTACT_MAIL_TO: "me@example.org",
  };

  it.effect("is off without SMTP_HOST", () =>
    Effect.gen(function* () {
      const exit = yield* load(MailConfig, {});
      assert.isTrue(Exit.isSuccess(exit) && Option.isNone(exit.value));
    }),
  );

  it.effect("defaults to STARTTLS on 587 without credentials", () =>
    Effect.gen(function* () {
      const exit = yield* load(MailConfig, smtp);
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit) && Option.isSome(exit.value)) {
        assert.strictEqual(exit.value.value.port, 587);
        assert.strictEqual(exit.value.value.security, "starttls");
        assert.isTrue(Option.isNone(exit.value.value.auth));
      }
    }),
  );

  it.effect("uses port 465 for implicit TLS", () =>
    Effect.gen(function* () {
      const exit = yield* load(MailConfig, { ...smtp, SMTP_SECURITY: "tls" });
      assert.isTrue(
        Exit.isSuccess(exit) &&
          Option.isSome(exit.value) &&
          exit.value.value.port === 465,
      );
    }),
  );

  it.effect.each([
    { SMTP_HOST: "mail.example.org", CONTACT_MAIL_TO: "me@example.org" },
    { SMTP_HOST: "mail.example.org", SMTP_FROM: "noreply@example.org" },
    { ...smtp, SMTP_USER: "me" },
    { ...smtp, SMTP_SECURITY: "plain" },
  ])("rejects a half-finished setup %o", (env) =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isFailure(yield* load(MailConfig, env)));
    }),
  );
});

describe("ContactRetentionConfig", () => {
  it.effect("defaults to 90 days and must be positive", () =>
    Effect.gen(function* () {
      const exit = yield* load(ContactRetentionConfig, {});
      assert.isTrue(
        Exit.isSuccess(exit) &&
          Duration.toMillis(exit.value) ===
            Duration.toMillis(Duration.days(90)),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* load(ContactRetentionConfig, {
            CONTACT_RETENTION: "0 days",
          }),
        ),
      );
    }),
  );
});

describe("MailConfig security", () => {
  const base = {
    SMTP_FROM: "noreply@example.org",
    CONTACT_MAIL_TO: "me@example.org",
    SMTP_SECURITY: "none",
  };

  it.effect("allows plain text only for a mail catcher on this machine", () =>
    Effect.gen(function* () {
      assert.isTrue(
        Exit.isSuccess(
          yield* load(MailConfig, { ...base, SMTP_HOST: "localhost" }),
        ),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* load(MailConfig, { ...base, SMTP_HOST: "mail.example.org" }),
        ),
      );
    }),
  );
});

describe("MailConfig addresses", () => {
  const base = { SMTP_HOST: "mail.example.org" };

  it.effect.each([
    { SMTP_FROM: "noreply@example.org", CONTACT_MAIL_TO: "me@example.org" },
    {
      SMTP_FROM: "Website <noreply@example.org>",
      CONTACT_MAIL_TO: "me@example.org",
    },
  ])("accepts %o", (env) =>
    Effect.gen(function* () {
      assert.isTrue(
        Exit.isSuccess(yield* load(MailConfig, { ...base, ...env })),
      );
    }),
  );

  it.effect.each([
    { SMTP_FROM: "noreply", CONTACT_MAIL_TO: "me@example.org" },
    { SMTP_FROM: "noreply@example.org", CONTACT_MAIL_TO: "me" },
    { SMTP_FROM: "noreply@example.org", CONTACT_MAIL_TO: "a@b.org, c@d.org" },
    {
      SMTP_FROM: "Name <noreply@example.org",
      CONTACT_MAIL_TO: "me@example.org",
    },
  ])("rejects %o at startup", (env) =>
    Effect.gen(function* () {
      assert.isTrue(
        Exit.isFailure(yield* load(MailConfig, { ...base, ...env })),
      );
    }),
  );
});

describe("KeycloakAdminConfig", () => {
  it.effect("needs the secret and defaults the client id", () =>
    Effect.gen(function* () {
      assert.isTrue(Exit.isFailure(yield* load(KeycloakAdminConfig, {})));
      const exit = yield* load(KeycloakAdminConfig, {
        KEYCLOAK_ADMIN_CLIENT_SECRET: "s3cret",
      });
      assert.isTrue(
        Exit.isSuccess(exit) &&
          exit.value.clientId === "unhalteproblem-backend-admin",
      );
    }),
  );
});
