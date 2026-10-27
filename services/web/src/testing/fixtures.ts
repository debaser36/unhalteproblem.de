import { type Role, SessionInfo } from "@unhalteproblem.de/api";
import { Schema } from "effect";

/**
 * Builds a value of a contract schema from its JSON form, the way the
 * client decodes responses, so fixtures get brands and dates right.
 */
export const decode =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (encoded: S["Encoded"]): S["Type"] =>
    Schema.decodeUnknownSync(schema)(encoded);

/** A session of the test user "Ada" holding `roles`. */
export const sessionWith = (roles: ReadonlyArray<Role>): SessionInfo =>
  decode(SessionInfo)({
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      username: "ada",
      name: "Ada Lovelace",
      email: "ada@example.org",
      roles: [...roles],
    },
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
