import { SignedUserInfo, UserInfo } from "#domain/Claims";
import { BearerAuthorization } from "#domain/Credentials";
import {
  OAuthBadRequest,
  OAuthForbidden,
  OAuthUnauthorized,
} from "#errors/OAuthError";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** The userinfo endpoint (OIDC Core §5.3), protected by the user's access token. */
export class UserInfoGroup extends HttpApiGroup.make("userinfo")
  .add(
    HttpApiEndpoint.get("get", "/protocol/openid-connect/userinfo", {
      // Per call rather than as middleware: every user has their own token.
      headers: { authorization: BearerAuthorization },
      // JSON by default; a JWT when the client is configured for signed
      // userinfo responses. The client picks by response content type.
      success: [
        UserInfo,
        SignedUserInfo.pipe(
          HttpApiSchema.asText({ contentType: "application/jwt" }),
        ),
      ],
      // RFC 6750 §3.1: 401 `invalid_token` for a missing, expired or revoked
      // token, 403 `insufficient_scope` without the `openid` scope.
      error: [OAuthBadRequest, OAuthUnauthorized, OAuthForbidden],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "User info",
        description: "Claims about the user the access token was issued for.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "UserInfo",
      description: "Claims about the authenticated user.",
    }),
  ) {}
