// The payment groups: their OpenAPI document and their middlewares.
import { assert, describe, it } from "@effect/vitest";
import { HttpApi, OpenApi } from "effect/http-api";
import { Api } from "#Api";
import { Authentication } from "#Authentication";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { RequireAdmin, RequireSuperAdmin } from "./Admin.ts";

describe("payment endpoints in the OpenAPI document", () => {
  const spec = OpenApi.fromApi(Api);
  type Method = "get" | "post" | "patch" | "put";
  const operation = (path: string, method: Method) =>
    spec.paths[path]?.[method];
  const statuses = (path: string, method: Method) =>
    Object.keys(operation(path, method)?.responses ?? {}).sort();

  it("documents the response statuses", () => {
    assert.deepStrictEqual(statuses("/payments/catalog", "get"), ["200"]);
    assert.deepStrictEqual(statuses("/payments/checkout", "post"), [
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "502",
      "503",
    ]);
    assert.deepStrictEqual(statuses("/payments/portal", "post"), [
      "200",
      "401",
      "403",
      "404",
      "502",
      "503",
    ]);
    assert.deepStrictEqual(statuses("/payments/me", "get"), ["200", "401"]);
    assert.deepStrictEqual(statuses("/payments/stripe/webhook", "post"), [
      "200",
      "400",
      "503",
    ]);
  });

  it("takes the webhook as raw JSON text with a required signature", () => {
    const webhook = operation("/payments/stripe/webhook", "post");
    assert.deepStrictEqual(webhook?.security, []);
    assert.deepStrictEqual(
      webhook?.parameters?.map((p) => [p.name, p.in, p.required]),
      [["stripe-signature", "header", true]],
    );
    assert.deepStrictEqual(Object.keys(webhook?.requestBody?.content ?? {}), [
      "application/json",
    ]);
    assert.deepStrictEqual(
      (
        webhook?.requestBody?.content["application/json"]?.schema as
          { type?: string } | undefined
      )?.type,
      "string",
    );
  });

  it("keeps the catalog and the webhook public", () => {
    assert.deepStrictEqual(operation("/payments/catalog", "get")?.security, []);
    assert.deepStrictEqual(operation("/payments/me", "get")?.security, [
      { session: [] },
    ]);
  });
});

describe("payment endpoint middleware", () => {
  const middlewares = new Map<string, Array<string>>();
  HttpApi.reflect(Api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware }) => {
      if (!group.identifier.startsWith("payment")) return;
      middlewares.set(
        `${group.identifier}.${endpoint.identifier}`,
        [...middleware].map((m) => m.key),
      );
    },
  });
  const has = (name: string, key: string) =>
    middlewares.get(name)?.includes(key) ?? false;

  it("has the endpoints of the design", () => {
    assert.deepStrictEqual([...middlewares.keys()].sort(), [
      "paymentAdmin.listPaymentProducts",
      "paymentAdmin.listPayments",
      "paymentAdmin.listSubscriptions",
      "paymentAdmin.refundPayment",
      "paymentAdmin.setPaymentProductRoles",
      "paymentAdmin.syncPaymentProducts",
      "paymentAdmin.updatePaymentProduct",
      "paymentCatalog.getCatalog",
      "paymentWebhooks.stripeWebhook",
      "payments.myPayments",
      "payments.openBillingPortal",
      "payments.startCheckout",
    ]);
  });

  it("protects what is not public on purpose", () => {
    for (const name of middlewares.keys()) {
      const isPublic =
        name === "paymentCatalog.getCatalog" ||
        name === "paymentWebhooks.stripeWebhook";
      assert.strictEqual(has(name, Authentication.key), !isPublic, name);
    }
    assert.isTrue(has("paymentWebhooks.stripeWebhook", LargeBody.key));
  });

  it("requires the origin on every write and the right role", () => {
    const writes = [
      "payments.startCheckout",
      "payments.openBillingPortal",
      "paymentAdmin.refundPayment",
      "paymentAdmin.syncPaymentProducts",
      "paymentAdmin.updatePaymentProduct",
      "paymentAdmin.setPaymentProductRoles",
    ];
    for (const name of middlewares.keys()) {
      assert.strictEqual(
        has(name, SameOrigin.key),
        writes.includes(name),
        name,
      );
      if (name.startsWith("paymentAdmin.")) {
        const superAdmin = name === "paymentAdmin.setPaymentProductRoles";
        assert.strictEqual(has(name, RequireAdmin.key), !superAdmin, name);
        assert.strictEqual(has(name, RequireSuperAdmin.key), superAdmin, name);
      }
    }
  });
});
