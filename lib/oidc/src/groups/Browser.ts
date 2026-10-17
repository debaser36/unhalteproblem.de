import { AuthorizationRequest } from "#domain/Authorization";
import { EndSessionRequest } from "#domain/Logout";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * An HTML page of the provider (login form, logout confirmation, error
 * page). Only here to describe what the user agent gets; nothing decodes it.
 */
const ProviderPage = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "text/html" }),
).annotate({ description: "A page of the provider, shown to the user." });

/**
 * Endpoints the user agent is sent to ("front channel"). Never call them
 * with `HttpApiClient.make`; build the URL with
 * `HttpApiClient.urlBuilder(OidcApi, { baseUrl: issuer })` and redirect the
 * browser to it. They end with a redirect to the client's `redirect_uri` or
 * `post_logout_redirect_uri`, where `AuthorizationCallback` and
 * `EndSessionCallback` describe the query.
 */
export class BrowserGroup extends HttpApiGroup.make("browser")
  .add(
    HttpApiEndpoint.get("authorize", "/protocol/openid-connect/auth", {
      query: AuthorizationRequest,
      success: ProviderPage,
      // Errors come back as a redirect to the `redirect_uri`
      // (`AuthorizationErrorResponse`), or, for an unknown client or
      // redirect URI, as an error page the client never sees.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Authentication request",
        description:
          "Starts the authorization code flow with PKCE (OIDC Core §3.1.2).",
      }),
    ),
    HttpApiEndpoint.get("endSession", "/protocol/openid-connect/logout", {
      query: EndSessionRequest,
      success: ProviderPage,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "End session",
        description:
          "Logs the user out at the provider (RP-Initiated Logout 1.0).",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Browser",
      description: "Endpoints the user agent is redirected to.",
    }),
  ) {}
