import { assert, describe, it } from "@effect/vitest";
import { HttpApi } from "effect/http-api";
import { Api } from "#Api";
import { SameOrigin } from "#SameOrigin";

/**
 * The state-changing endpoints that do without `SameOrigin`, and why. A new
 * one belongs here only with a reason as good as these.
 */
const exempt = [
  // Anonymous: it uses no cookie, so a forged request gains nothing a
  // direct one wouldn't. It is rate limited instead.
  "contact.submit",
  // A plain form POST; the handler checks `Origin` itself.
  "auth.logout",
  // Called server-to-server by Keycloak, which sends no `Origin`; the
  // signed logout token is the proof.
  "auth.backchannelLogout",
  // Called server-to-server by Stripe, which sends no `Origin`; the
  // signature of the raw body is the proof.
  "paymentWebhooks.stripeWebhook",
];

describe("SameOrigin across the API", () => {
  // Every endpoint that is not a GET, with whether it requires SameOrigin
  // (group middleware included).
  const stateChanging = new Map<string, boolean>();
  HttpApi.reflect(Api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware }) => {
      if (endpoint.method === "GET") return;
      stateChanging.set(
        `${group.identifier}.${endpoint.identifier}`,
        [...middleware].some((m) => m.key === SameOrigin.key),
      );
    },
  });

  it("is required by every state-changing endpoint but the exempt ones", () => {
    const without = [...stateChanging]
      .filter(([, required]) => !required)
      .map(([name]) => name);
    assert.deepStrictEqual(without.sort(), [...exempt].sort());
  });

  it("finds state-changing endpoints at all", () => {
    assert.isAbove(stateChanging.size, exempt.length);
  });
});
