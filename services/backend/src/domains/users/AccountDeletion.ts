import { Subject } from "@unhalteproblem.de/oidc";
import { Effect, Layer, Schema } from "effect";
import * as Outbox from "#cqrs/Outbox";
import { KeycloakAdmin } from "#infrastructure/KeycloakAdmin";

/**
 * Delete the user in Keycloak after they deleted their account here. The
 * payload is the Keycloak id (the OIDC `sub`), which is how Keycloak knows
 * the user; no profile data.
 */
export const DeleteKeycloakUser = Outbox.topic(
  "account.delete-keycloak-user",
  Schema.Struct({ subject: Subject }),
);

/**
 * Carries out `DeleteKeycloakUser` from the outbox: at least once, with
 * retries while Keycloak is down or the client lacks the permission (those
 * attempts end up dead after the last one, visible in `outbox`). Deleting a
 * user that is gone already succeeds, so a repeat is harmless.
 *
 * Needs `Outbox` and `KeycloakAdmin`.
 */
export const KeycloakUserDeletion = Layer.unwrap(
  Effect.gen(function* () {
    const keycloak = yield* KeycloakAdmin;
    return Outbox.consumer(DeleteKeycloakUser, ({ subject }) =>
      keycloak.deleteUser(subject),
    );
  }),
);
