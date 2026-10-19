import { Authentication } from "#Authentication";
import { AccountDeletionNotAllowed } from "#errors/AccountDeletionNotAllowed";
import { SameOrigin } from "#SameOrigin";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Self-service for the logged-in user's own account. Every endpoint requires
 * a session (`Authentication`, 401 `Unauthorized`); the state-changing ones
 * also require `SameOrigin` (403 `Forbidden` for a foreign or missing
 * `Origin`). No role is needed: every user may manage their own account.
 */
export class AccountGroup extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.post("deleteAccount", "/account/delete", {
      success: HttpApiSchema.NoContent.annotate({
        description:
          "The account is deleted and the session cookie is cleared " +
          "(`Set-Cookie`).",
      }),
      error: AccountDeletionNotAllowed,
    })
      // The group's `Authentication` runs first (see below), so a missing
      // session answers 401 before the origin is checked.
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Delete the own account",
          description:
            "Requires a session and a same-origin request. Deletes the " +
            "logged-in user's account: ends all their sessions, clears the " +
            "profile (name, email and username), removes their roles and " +
            "removes the user at the identity provider. The response " +
            "clears the session cookie. Irreversible. Not idempotent: the " +
            "session no longer exists afterwards, so a repeated call " +
            "answers 401 `Unauthorized`. Answers 204 without a body, 403 " +
            "`Forbidden` for a foreign or missing `Origin`, and 409 " +
            "`AccountDeletionNotAllowed` (`superAdmin`) while the user " +
            "holds `superAdmin`: another superAdmin has to revoke that " +
            "role first.",
        }),
      ),
  )
  // Protects every endpoint above; added after them, so it runs before
  // their own middlewares and answers 401 before any 403.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Account",
      description:
        "Self-service for the logged-in user's own account: deleting it.",
    }),
  ) {}
