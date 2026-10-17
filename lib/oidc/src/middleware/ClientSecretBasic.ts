import { Redacted } from "effect";
import { HttpClientRequest } from "effect/http";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";

/**
 * `client_secret_basic` client authentication (RFC 6749 §2.3.1): the client
 * id and secret in an HTTP Basic `Authorization` header. Keycloak's default
 * for confidential clients.
 *
 * Applied to the token, revocation and introspection endpoints. It is not
 * required by the generated client: a client built without
 * `layerClientSecretBasic` sends no header, which is what public clients
 * (and confidential ones using `client_secret_post`) want.
 *
 * Only the client side is ever used; the server side is Keycloak.
 */
export class ClientSecretBasic extends HttpApiMiddleware.Service<ClientSecretBasic>()(
  "@unhalteproblem.de/oidc/ClientSecretBasic",
  { security: { clientSecretBasic: HttpApiSecurity.basic } },
) {}

// RFC 6749 §2.3.1 requires both parts to be encoded with
// application/x-www-form-urlencoded before Base64. Keycloak decodes them
// accordingly, so a secret containing e.g. ":" or "+" survives.
const formEncode = (value: string) =>
  encodeURIComponent(value).replace(/%20/g, "+");

/**
 * Authenticates every request to the token, revocation and introspection
 * endpoints with the given confidential client's credentials. Provide it
 * when building the client with `HttpApiClient.make(OidcApi, ...)`.
 */
export const layerClientSecretBasic = (credentials: {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
}) =>
  HttpApiMiddleware.layerClient(ClientSecretBasic, ({ request, next }) =>
    next(
      HttpClientRequest.basicAuth(
        request,
        formEncode(credentials.clientId),
        Redacted.make(formEncode(Redacted.value(credentials.clientSecret))),
      ),
    ),
  );
