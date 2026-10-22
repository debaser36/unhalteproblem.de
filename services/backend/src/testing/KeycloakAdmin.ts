import { Effect, Layer } from "effect";
import { KeycloakAdmin } from "#infrastructure/KeycloakAdmin";

/**
 * A `KeycloakAdmin` that records the subjects it was asked to delete instead
 * of calling Keycloak. Test support only, like everything in `#testing/*`.
 */
export const makeRecordingKeycloak = () => {
  const deleted: Array<string> = [];
  const layer = Layer.succeed(
    KeycloakAdmin,
    KeycloakAdmin.of({
      deleteUser: (subject) =>
        Effect.sync(() => {
          deleted.push(subject);
        }),
    }),
  );
  return { deleted, layer };
};
