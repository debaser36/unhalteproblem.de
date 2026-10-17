import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit } from "effect";
import { OidcConfig, PublicUrlConfig } from "./Config.ts";

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
