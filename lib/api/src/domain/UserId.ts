// Separate from `Admin` so that `Blog` can use it: `Admin` imports `Auth`,
// which imports `Blog` (an import cycle otherwise).
import { Schema } from "effect";

/**
 * Our own id of a user (a UUID), assigned by the backend at registration and
 * independent of the identity provider. Admin endpoints address users by it
 * (`/admin/users/:userId`).
 *
 * Not the same as `User.id` of the session (`GET /auth/session`), which is
 * the OIDC subject (`sub`), Keycloak's id of the user; an `AdminUser` carries
 * both, as `id` and `subject`. The backend's domain uses the same brand
 * name, so values pass between the two without conversion.
 */
export const UserId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("UserId"))
  .annotate({
    identifier: "UserId",
    description:
      "Our own id of a user (a UUID). Not the OIDC subject (`sub`), which " +
      "is the session's `User.id`.",
  });
export type UserId = typeof UserId.Type;
