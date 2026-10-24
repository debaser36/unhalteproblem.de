import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Json, makeBlogApp } from "#testing/Blogs";
import { makeFakeStripe, product, signed } from "#testing/Stripe";

const productId = "prod_Premium1";
const priceId = "price_Premium1";

/**
 * The app with a configured fake Stripe that sells one product (a monthly
 * price), offered by `admin`; `user` and `other` are plain users.
 */
const setup = Effect.gen(function* () {
  const stripe = makeFakeStripe();
  stripe.state.products.set(
    productId,
    product(productId, [{ id: priceId, amount: 500, interval: "month" }]),
  );
  const app = yield* makeBlogApp({ stripe: stripe.layer });
  yield* app.expect(
    200,
    app.admin.cookie,
    "POST",
    "/admin/payments/products/sync",
  );
  yield* app.expect(
    200,
    app.admin.cookie,
    "PATCH",
    `/admin/payments/products/${productId}`,
    { body: { enabled: true, kind: "standard" } },
  );
  return { ...app, stripe };
});

/** A webhook delivery as Stripe sends it. */
const webhook = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
  delivery: { readonly payload: string; readonly signature: string | null },
) =>
  request("/payments/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(delivery.signature === null
        ? {}
        : { "stripe-signature": delivery.signature }),
    },
    body: delivery.payload,
  });

const event = (id: string) =>
  signed({
    id,
    type: "customer.subscription.updated",
    object: { id: "sub_x", object: "subscription" },
  });

describe("GET /payments/catalog", () => {
  it.effect("is public, briefly cacheable and lists the offered products", () =>
    Effect.gen(function* () {
      const { request } = yield* setup;
      const response = yield* request("/payments/catalog");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get("cache-control"),
        "public, max-age=60",
      );
      const body = (yield* Effect.promise(() => response.json())) as Json;
      assert.isNull(body["tip"]);
      const products = body["products"] as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        products.map((item) => [item["id"], item["prices"]]),
        [
          [
            productId,
            [
              {
                id: priceId,
                amount: { amount: 500, currency: "eur" },
                recurring: { interval: "month", intervalCount: 1 },
              },
            ],
          ],
        ],
      );
    }),
  );

  it.effect("is empty while Stripe is not configured", () =>
    Effect.gen(function* () {
      const { request } = yield* makeBlogApp();
      const response = yield* request("/payments/catalog");
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        products: [],
        tip: null,
      });
    }),
  );
});

describe("POST /payments/stripe/webhook", () => {
  it.effect("answers 200 to a valid signature and queues the event once", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* setup;
      const delivery = event("evt_http_1");
      for (const _ of [1, 2]) {
        const response = yield* webhook(request, delivery);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get("cache-control"), "no-store");
      }
      const rows = yield* sql(
        (sql) => sql<{ readonly n: number }>`
          SELECT count(*)::int AS n FROM outbox
          WHERE topic = 'payments.stripe-event'
            AND payload->>'eventId' = 'evt_http_1'
        `,
      );
      assert.strictEqual(rows[0]?.n, 1);
    }),
  );

  it.effect("answers 400 InvalidWebhookSignature to a bad signature", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* setup;
      const { payload } = event("evt_http_2");
      const forged = yield* webhook(request, {
        payload,
        signature: "t=1,v1=00",
      });
      assert.strictEqual(forged.status, 400);
      const body = (yield* Effect.promise(() => forged.json())) as Json;
      assert.strictEqual(body["_tag"], "InvalidWebhookSignature");
      // Without the header the request fails validation, before the handler.
      const unsigned = yield* webhook(request, { payload, signature: null });
      assert.strictEqual(unsigned.status, 400);
      const rows = yield* sql(
        (sql) => sql<{ readonly n: number }>`
          SELECT count(*)::int AS n FROM outbox
          WHERE payload->>'eventId' = 'evt_http_2'
        `,
      );
      assert.strictEqual(rows[0]?.n, 0);
    }),
  );

  it.effect("answers 400 when the body was changed after signing", () =>
    Effect.gen(function* () {
      const { request } = yield* setup;
      const { payload, signature } = event("evt_http_3");
      const response = yield* webhook(request, {
        payload: payload.replace("sub_x", "sub_y"),
        signature,
      });
      assert.strictEqual(response.status, 400);
    }),
  );

  it.effect(
    "answers 503 PaymentsUnavailable while Stripe is not configured",
    () =>
      Effect.gen(function* () {
        const { request } = yield* makeBlogApp();
        const response = yield* webhook(request, event("evt_http_4"));
        assert.strictEqual(response.status, 503);
        const body = (yield* Effect.promise(() => response.json())) as Json;
        assert.strictEqual(body["_tag"], "PaymentsUnavailable");
      }),
  );
});

describe("POST /payments/checkout", () => {
  const body = { kind: "price", priceId };

  it.effect("needs a session", () =>
    Effect.gen(function* () {
      const { call } = yield* setup;
      const response = yield* call(undefined, "POST", "/payments/checkout", {
        body,
      });
      assert.strictEqual(response.status, 401);
    }),
  );

  it.effect("needs the site's Origin", () =>
    Effect.gen(function* () {
      const { call, user, stripe } = yield* setup;
      for (const origin of [null, "https://evil.example"]) {
        const response = yield* call(
          user.cookie,
          "POST",
          "/payments/checkout",
          {
            body,
            origin,
          },
        );
        assert.strictEqual(response.status, 403);
      }
      assert.lengthOf(stripe.state.checkouts, 0);
    }),
  );

  it.effect("answers with the Checkout URL for the logged-in user", () =>
    Effect.gen(function* () {
      const { call, user, stripe } = yield* setup;
      const response = yield* call(user.cookie, "POST", "/payments/checkout", {
        body,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      const answer = (yield* Effect.promise(() => response.json())) as Json;
      assert.match(
        String(answer["url"]),
        /^https:\/\/checkout\.stripe\.com\//u,
      );
      assert.deepStrictEqual(
        stripe.state.checkouts.map(({ mode, userId, metadata }) => ({
          mode,
          userId,
          metadata,
        })),
        [
          {
            mode: "subscription",
            userId: user.id,
            metadata: { kind: "subscription", productId },
          },
        ],
      );
    }),
  );

  it.effect("answers 404 PaymentPriceNotFound for an unknown price", () =>
    Effect.gen(function* () {
      const { expect, user } = yield* setup;
      const answer = yield* expect(
        404,
        user.cookie,
        "POST",
        "/payments/checkout",
        {
          body: { kind: "price", priceId: "price_unknown" },
        },
      );
      assert.strictEqual(answer["_tag"], "PaymentPriceNotFound");
    }),
  );
});

describe("the payment admin endpoints", () => {
  it.effect("list payments for admins only", () =>
    Effect.gen(function* () {
      const { call, admin, user } = yield* setup;
      assert.strictEqual(
        (yield* call(undefined, "GET", "/admin/payments")).status,
        401,
      );
      assert.strictEqual(
        (yield* call(user.cookie, "GET", "/admin/payments")).status,
        403,
      );
      const response = yield* call(admin.cookie, "GET", "/admin/payments");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
    }),
  );

  it.effect("set the roles of a product for superAdmins only", () =>
    Effect.gen(function* () {
      const { call, expect, admin, superAdmin, user, stripe } = yield* setup;
      const path = `/admin/payments/products/${productId}/roles`;
      const body = { roles: ["foodPlanner"] };

      assert.strictEqual(
        (yield* call(undefined, "PUT", path, { body })).status,
        401,
      );
      assert.strictEqual(
        (yield* call(user.cookie, "PUT", path, { body })).status,
        403,
      );
      const refused = yield* call(admin.cookie, "PUT", path, { body });
      assert.strictEqual(refused.status, 403);
      const unchanged = (yield* expect(
        200,
        admin.cookie,
        "GET",
        "/admin/payments/products",
      )) as unknown as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        unchanged.map((product) => product["roles"]),
        [[]],
      );

      const noOrigin = yield* call(superAdmin.cookie, "PUT", path, {
        body,
        origin: null,
      });
      assert.strictEqual(noOrigin.status, 403);

      const answer = yield* expect(200, superAdmin.cookie, "PUT", path, {
        body,
      });
      assert.deepStrictEqual(answer["roles"], ["foodPlanner"]);
      assert.lengthOf(stripe.state.checkouts, 0);
    }),
  );
});

describe("the credits of products", () => {
  it.effect("are set for superAdmins only, and shown in the catalog", () =>
    Effect.gen(function* () {
      const { call, expect, request, admin, superAdmin, user } = yield* setup;
      const path = `/admin/payments/products/${productId}/credits`;
      const body = { credits: [{ feature: "mealPlan", quantity: 3 }] };

      assert.strictEqual(
        (yield* call(undefined, "PUT", path, { body })).status,
        401,
      );
      assert.strictEqual(
        (yield* call(user.cookie, "PUT", path, { body })).status,
        403,
      );
      assert.strictEqual(
        (yield* call(admin.cookie, "PUT", path, { body })).status,
        403,
      );
      assert.strictEqual(
        (yield* call(superAdmin.cookie, "PUT", path, { body, origin: null }))
          .status,
        403,
      );
      const unchanged = (yield* expect(
        200,
        admin.cookie,
        "GET",
        "/admin/payments/products",
      )) as unknown as ReadonlyArray<Json>;
      assert.deepStrictEqual(
        unchanged.map((item) => item["credits"]),
        [[]],
      );

      const answer = yield* expect(200, superAdmin.cookie, "PUT", path, {
        body,
      });
      assert.deepStrictEqual(answer["credits"], body.credits);

      const response = yield* request("/payments/catalog");
      const catalog = (yield* Effect.promise(() => response.json())) as Json;
      assert.deepStrictEqual(
        (catalog["products"] as ReadonlyArray<Json>).map(
          (item) => item["credits"],
        ),
        [body.credits],
      );
    }),
  );

  it.effect("are refused for invalid input and unknown products", () =>
    Effect.gen(function* () {
      const { expect, call, superAdmin } = yield* setup;
      const path = `/admin/payments/products/${productId}/credits`;
      const feature = "mealPlan";
      for (const credits of [
        [{ feature, quantity: 0 }],
        [{ feature, quantity: 101 }],
        [{ feature: "somethingElse", quantity: 1 }],
        [
          { feature, quantity: 1 },
          { feature, quantity: 2 },
        ],
      ]) {
        assert.strictEqual(
          (yield* call(superAdmin.cookie, "PUT", path, { body: { credits } }))
            .status,
          400,
        );
      }
      yield* expect(
        404,
        superAdmin.cookie,
        "PUT",
        "/admin/payments/products/prod_unknown/credits",
        { body: { credits: [{ feature, quantity: 1 }] } },
      );
    }),
  );

  it.effect(
    "leave a user's own payments without a balance if they have none",
    () =>
      Effect.gen(function* () {
        const { expect, user } = yield* setup;
        const me = yield* expect(200, user.cookie, "GET", "/payments/me");
        assert.deepStrictEqual(me["credits"], []);
      }),
  );
});

describe("roles and credits of a product", () => {
  const credits = { credits: [{ feature: "mealPlan", quantity: 3 }] };
  const roles = { roles: ["foodPlanner"] };
  const pathOf = (what: "roles" | "credits") =>
    `/admin/payments/products/${productId}/${what}`;

  it.effect("are never granted together (409)", () =>
    Effect.gen(function* () {
      const { expect, superAdmin } = yield* setup;
      yield* expect(200, superAdmin.cookie, "PUT", pathOf("roles"), {
        body: roles,
      });
      yield* expect(409, superAdmin.cookie, "PUT", pathOf("credits"), {
        body: credits,
      });
      // Removing the roles makes room for credits, and the other way round.
      yield* expect(200, superAdmin.cookie, "PUT", pathOf("roles"), {
        body: { roles: [] },
      });
      yield* expect(200, superAdmin.cookie, "PUT", pathOf("credits"), {
        body: credits,
      });
      yield* expect(409, superAdmin.cookie, "PUT", pathOf("roles"), {
        body: roles,
      });
    }),
  );
});
