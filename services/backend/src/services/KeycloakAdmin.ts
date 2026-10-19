import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { OidcConfig } from "#Config";

/**
 * Keycloak's admin API did not do what was asked. `reason` is a short code
 * (`token:401`, `delete:403`, `transport`) for logs and `outbox.last_error`;
 * it never holds a response body, which can quote the user or the secret.
 */
export class KeycloakAdminFailed extends Schema.TaggedError<
  KeycloakAdminFailed,
  { readonly brand: unique symbol }
>()("KeycloakAdminFailed", { reason: Schema.String }) {}

/** What the token endpoint answers; everything but the token is ignored. */
const TokenResponse = Schema.Struct({
  access_token: Schema.RedactedFromValue(Schema.String),
});

interface Options {
  /** The realm URL, `https://host/realms/<realm>`. */
  readonly issuer: string;
  /** The backend's client; it needs a service account (see the README). */
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
}

const timeout = Duration.seconds(10);

/** `https://host/realms/x` → the admin API root of realm `x`, if it is one. */
const adminRoot = (issuer: string): Option.Option<string> => {
  const match = /^(.*)\/realms\/([^/]+)$/.exec(issuer);
  return match === null
    ? Option.none()
    : Option.some(`${match[1]}/admin/realms/${match[2]}`);
};

// application/x-www-form-urlencoded, as RFC 6749 §2.3.1 asks for the
// client id and secret in HTTP Basic: a space is `+`, not `%20`.
const formEncode = (value: string) =>
  new URLSearchParams([["", value]]).toString().slice(1);

const make = (options: Options) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const root = Option.getOrUndefined(adminRoot(options.issuer));
    if (root === undefined) {
      return yield* Effect.die(
        new Error(
          "OIDC_ISSUER is not a Keycloak realm URL (https://host/realms/<realm>)",
        ),
      );
    }

    const failure = (stage: string) => (error: unknown) =>
      new KeycloakAdminFailed({
        reason:
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "KeycloakAdminFailed"
            ? (error as KeycloakAdminFailed).reason
            : `${stage}:transport`,
      });

    const expect =
      (stage: string, ...statuses: ReadonlyArray<number>) =>
      (response: HttpClientResponse.HttpClientResponse) =>
        statuses.includes(response.status)
          ? Effect.succeed(response)
          : Effect.fail(
              new KeycloakAdminFailed({
                reason: `${stage}:${response.status}`,
              }),
            );

    // The service account's token, fetched when needed: deleting accounts is
    // rare, so nothing is cached and nothing outlives the call.
    const accessToken = http
      .execute(
        HttpClientRequest.post(
          `${options.issuer}/protocol/openid-connect/token`,
        ).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.basicAuth(
            formEncode(options.clientId),
            Redacted.make(formEncode(Redacted.value(options.clientSecret))),
          ),
          HttpClientRequest.bodyUrlParams({ grant_type: "client_credentials" }),
        ),
      )
      .pipe(
        Effect.flatMap(expect("token", 200)),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse)),
        Effect.map(({ access_token }) => access_token),
        Effect.mapError(failure("token")),
      );

    return KeycloakAdmin.of({
      deleteUser: Effect.fn("KeycloakAdmin.deleteUser")(
        function* (subject: string) {
          const token = yield* accessToken;
          yield* http
            .execute(
              HttpClientRequest.delete(
                `${root}/users/${encodeURIComponent(subject)}`,
              ).pipe(HttpClientRequest.bearerToken(token)),
            )
            // 404: gone already, which is what was asked for.
            .pipe(Effect.flatMap(expect("delete", 204, 404)));
        },
        (self) =>
          self.pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.fail(new KeycloakAdminFailed({ reason: "timeout" })),
            }),
            Effect.mapError(failure("delete")),
          ),
      ),
    });
  });

/** Deletes users in the identity provider (Keycloak's admin API). */
export class KeycloakAdmin extends Context.Service<
  KeycloakAdmin,
  {
    /**
     * Deletes the Keycloak user with this id (the OIDC `sub`). Succeeds if
     * the user is already gone, so it can be repeated.
     */
    readonly deleteUser: (
      subject: string,
    ) => Effect.Effect<void, KeycloakAdminFailed>;
  }
>()("@unhalteproblem.de/backend/KeycloakAdmin") {
  /** For tests and special setups: the given realm and client. */
  static readonly layerWith = (
    options: Options,
  ): Layer.Layer<KeycloakAdmin, never, HttpClient.HttpClient> =>
    Layer.effect(KeycloakAdmin, make(options));

  /** The configured realm (`OIDC_*`), over `fetch`. */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* OidcConfig;
      return KeycloakAdmin.layerWith({
        issuer: config.issuer,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
