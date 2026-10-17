import { BrowserGroup } from "#groups/Browser";
import { DiscoveryGroup } from "#groups/Discovery";
import { TokenGroup } from "#groups/Token";
import { UserInfoGroup } from "#groups/UserInfo";
import { HttpApi, OpenApi } from "effect/http-api";

/**
 * The OpenID Provider's HTTP interface, for `HttpApiClient`.
 *
 * Schemas follow the specs; the paths are Keycloak's, relative to the
 * issuer. Use the issuer as the base URL:
 *
 * ```ts
 * const issuer = "https://auth.example.org/realms/unhalteproblem"
 * const oidc = yield* HttpApiClient.make(OidcApi, { baseUrl: issuer })
 * const tokens = yield* oidc.token.grant({ payload: { ... } })
 * const loginUrl = HttpApiClient.urlBuilder(OidcApi, { baseUrl: issuer })
 *   .browser.authorize({ query: { ... } })
 * ```
 *
 * `urlBuilder` encodes synchronously and throws when the query is invalid
 * (e.g. a scope without `openid`); wrap the call in `Effect.try`.
 *
 * Confidential clients add `layerClientSecretBasic(...)` when building the
 * client. Group and endpoint names are the client's method names.
 *
 * The provider implements this API; nothing in this repository serves it.
 * Endpoints of our own that take part in the protocol (the redirect URI,
 * the back-channel logout URL) belong in `@unhalteproblem.de/api` and reuse
 * the schemas exported next to this.
 */
export class OidcApi extends HttpApi.make("oidc")
  .add(DiscoveryGroup)
  .add(BrowserGroup)
  .add(TokenGroup)
  .add(UserInfoGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "OpenID Provider (Keycloak)",
      description:
        "OpenID Connect and OAuth 2.0 endpoints of a Keycloak realm, relative to its issuer.",
    }),
  ) {}
