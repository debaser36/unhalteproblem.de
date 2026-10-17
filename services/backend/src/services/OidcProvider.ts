import {
  type AuthorizationCode,
  type CodeVerifier,
  type IdToken,
  layerClientSecretBasic,
  OidcApi,
  type TokenResponse,
} from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { OidcConfig, PublicUrlConfig } from "#Config";

/** The token endpoint refused the code or could not be reached. */
export class CodeExchangeFailed extends Schema.TaggedError<
  CodeExchangeFailed,
  { readonly brand: unique symbol }
>()("CodeExchangeFailed", { reason: Schema.String }) {}

/** How long the code exchange with the provider may take. */
const exchangeTimeout = "10 seconds";

/** Scopes requested at login: identity and the profile shown on the site. */
const scope = ["openid", "profile", "email"] as const;

/**
 * This backend as an OpenID Connect client (relying party) of Keycloak:
 * builds the URLs the browser is sent to and redeems authorization codes.
 */
export class OidcProvider extends Context.Service<
  OidcProvider,
  {
    /** The issuer, as configured. */
    readonly issuer: string;
    /** Where Keycloak sends the browser back to: `<api>/auth/callback`. */
    readonly redirectUri: string;
    /** The authentication request URL for a new login attempt. */
    readonly authorizationUrl: (request: {
      readonly state: string;
      readonly nonce: string;
      readonly codeChallenge: string;
    }) => Effect.Effect<string>;
    /** Redeems an authorization code with this client's credentials. */
    readonly exchangeCode: (request: {
      readonly code: AuthorizationCode;
      readonly codeVerifier: CodeVerifier;
    }) => Effect.Effect<TokenResponse, CodeExchangeFailed>;
    /** RP-initiated logout; Keycloak sends the browser back to the website. */
    readonly endSessionUrl: (
      idToken: IdToken | undefined,
    ) => Effect.Effect<string>;
  }
>()("@unhalteproblem.de/backend/OidcProvider") {
  static readonly layer = Layer.effect(
    OidcProvider,
    Effect.gen(function* () {
      const { issuer, clientId, clientSecret } = yield* OidcConfig;
      const { origin, apiUrl } = yield* PublicUrlConfig;
      const redirectUri = `${apiUrl}/auth/callback`;
      const postLogoutRedirectUri = `${origin}/`;

      const urls = HttpApiClient.urlBuilder(OidcApi, { baseUrl: issuer });
      const client = yield* HttpApiClient.make(OidcApi, {
        baseUrl: issuer,
      }).pipe(
        Effect.provide(layerClientSecretBasic({ clientId, clientSecret })),
      );

      // Every token's `iss` is compared with the configured issuer, so a
      // provider that reports another one (e.g. a wrong Keycloak hostname
      // setting) makes every login fail. Say so at startup, in the
      // background: an unreachable provider must not stop the backend.
      yield* client.discovery.configuration().pipe(
        Effect.flatMap((metadata) =>
          metadata.issuer === issuer
            ? Effect.logInfo("OpenID Provider reachable")
            : Effect.logError(
                "OpenID Provider reports another issuer; logins will fail",
              ).pipe(
                Effect.annotateLogs({
                  configured: issuer,
                  reported: metadata.issuer,
                }),
              ),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("OpenID Provider discovery failed", cause),
        ),
        Effect.annotateLogs({ issuer }),
        Effect.forkScoped,
      );

      return OidcProvider.of({
        issuer,
        redirectUri,
        // The query schemas are checked when encoding, which only fails for
        // values this code never produces; such a failure is a defect.
        authorizationUrl: ({ state, nonce, codeChallenge }) =>
          Effect.sync(() =>
            urls.browser.authorize({
              query: {
                response_type: "code",
                client_id: clientId,
                redirect_uri: redirectUri,
                scope,
                state,
                nonce,
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
              },
            }),
          ),
        exchangeCode: ({ code, codeVerifier }) =>
          client.token
            .grant({
              payload: {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
              },
            })
            .pipe(
              // Only the error kind and OAuth code are kept: a schema error's
              // message could quote the token response.
              Effect.mapError(
                (error) =>
                  new CodeExchangeFailed({
                    reason:
                      "error" in error && typeof error.error === "string"
                        ? `${error._tag}: ${error.error}`
                        : error._tag,
                  }),
              ),
              // The browser waits on this request; don't let a hanging
              // provider hold it open.
              Effect.timeoutOrElse({
                duration: exchangeTimeout,
                orElse: () =>
                  Effect.fail(new CodeExchangeFailed({ reason: "timeout" })),
              }),
              Effect.withSpan("OidcProvider.exchangeCode"),
            ),
        endSessionUrl: (idToken) =>
          Effect.sync(() =>
            urls.browser.endSession({
              query: {
                client_id: clientId,
                post_logout_redirect_uri: postLogoutRedirectUri,
                ...(idToken === undefined ? {} : { id_token_hint: idToken }),
              },
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
