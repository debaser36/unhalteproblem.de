import { Authentication } from "#Authentication";
import {
  AdminPayment,
  AdminPaymentPage,
  AdminPaymentQuery,
  AdminProduct,
  AdminSubscriptionPage,
  AdminSubscriptionQuery,
  PaymentId,
  RefundPayload,
  SetPaymentProductCreditsPayload,
  SetPaymentProductRolesPayload,
  StripeProductId,
  UpdatePaymentProductPayload,
} from "#domain/Payment";
import { PaymentNotFound } from "#errors/PaymentNotFound";
import { PaymentProductNotFound } from "#errors/PaymentProductNotFound";
import { PaymentProviderFailed } from "#errors/PaymentProviderFailed";
import { PaymentsUnavailable } from "#errors/PaymentsUnavailable";
import { ProductKindConflict } from "#errors/ProductKindConflict";
import { RefundNotAllowed } from "#errors/RefundNotAllowed";
import { RequireAdmin, RequireSuperAdmin } from "#groups/Admin";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/** Path parameters of the endpoints for one payment. */
const PaymentParams = { paymentId: PaymentId };

/** Path parameters of the endpoints for one product. */
const ProductParams = { productId: StripeProductId };

// Shared by every endpoint description.
const adminRule = "Requires `admin`. Answers with `Cache-Control: no-store`.";

/**
 * Payment administration: admins see every payment and subscription, refund
 * payments and decide which of the products mirrored from Stripe are
 * offered; superAdmins set the roles and the credits a product grants.
 * Every endpoint requires a session (`Authentication`, 401, on the group)
 * and a role (`RequireAdmin`, or `RequireSuperAdmin` for the roles and
 * credits of a product, 403 `Forbidden`). The state-changing endpoints also require `SameOrigin`
 * (403 `Forbidden`) and write an audit log entry in the same transaction as
 * their change. The backend answers every endpoint with
 * `Cache-Control: no-store`.
 *
 * Middleware order as in `AdminGroup`: `Authentication`, then the role,
 * then `SameOrigin`.
 */
export class PaymentAdminGroup extends HttpApiGroup.make("paymentAdmin")
  .add(
    HttpApiEndpoint.get("listPayments", "/admin/payments", {
      query: AdminPaymentQuery,
      success: AdminPaymentPage,
      // An invalid `limit`, `cursor`, `userId` or `status` is rejected by
      // schema validation (400). 401 and 403 come from the middlewares.
      error: [],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List payments",
          description:
            adminRule +
            " Returns one page of payments, newest first (by `createdAt`, " +
            "then `id`), optionally only those of one `userId` or with one " +
            "`status`. Paged by cursor: pass `nextCursor` (null on the " +
            "last page) as `cursor`, with the same filters, to get the " +
            "next page. `limit` is 1 to 200 (default 50).",
        }),
      ),
    HttpApiEndpoint.get("listSubscriptions", "/admin/payments/subscriptions", {
      query: AdminSubscriptionQuery,
      success: AdminSubscriptionPage,
      error: [],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List subscriptions",
          description:
            adminRule +
            " Returns one page of subscriptions, newest first (by " +
            "`createdAt`, then `id`), optionally only those of one " +
            "`userId` or with one `status`. Paged by cursor like " +
            "`listPayments`. `limit` is 1 to 200 (default 50).",
        }),
      ),
    HttpApiEndpoint.post("refundPayment", "/admin/payments/:paymentId/refund", {
      params: PaymentParams,
      payload: RefundPayload,
      success: AdminPayment,
      error: [
        PaymentNotFound,
        RefundNotAllowed,
        PaymentsUnavailable,
        PaymentProviderFailed,
      ],
    })
      .middleware(RequireAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Refund a payment",
          description:
            adminRule +
            " Requires a same-origin request. Refunds `amount` (the whole " +
            "remaining amount if absent) of the payment in Stripe and " +
            "answers with the updated payment. A full refund of a " +
            "one-off purchase ends the access it granted. Records " +
            "`payment_refunded` (target: the buyer, detail: the payment " +
            "id) in the audit log. Answers 404 `PaymentNotFound`, 409 " +
            "`RefundNotAllowed` (not paid, or more than what is left), " +
            "503 `PaymentsUnavailable` and 502 `PaymentProviderFailed`.",
        }),
      ),
    HttpApiEndpoint.get("listPaymentProducts", "/admin/payments/products", {
      success: Schema.Array(AdminProduct).annotate({
        description: "Every mirrored product.",
      }),
      error: [],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List payment products",
          description:
            adminRule +
            " Returns every product mirrored from Stripe with its prices, " +
            "whether it is enabled and the roles and credits it grants.",
        }),
      ),
    HttpApiEndpoint.post(
      "syncPaymentProducts",
      "/admin/payments/products/sync",
      {
        success: Schema.Array(AdminProduct).annotate({
          description: "Every product after the sync.",
        }),
        error: [PaymentsUnavailable, PaymentProviderFailed],
      },
    )
      .middleware(RequireAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Sync the payment products",
          description:
            adminRule +
            " Requires a same-origin request. Pulls the whole catalog " +
            "from Stripe now instead of waiting for webhooks and answers " +
            "with every product. Records `payment_catalog_synced` in the " +
            "audit log. Answers 503 `PaymentsUnavailable` and 502 " +
            "`PaymentProviderFailed`.",
        }),
      ),
    HttpApiEndpoint.patch(
      "updatePaymentProduct",
      "/admin/payments/products/:productId",
      {
        params: ProductParams,
        payload: UpdatePaymentProductPayload,
        success: AdminProduct,
        error: [PaymentProductNotFound, ProductKindConflict],
      },
    )
      .middleware(RequireAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Update a payment product",
          description:
            adminRule +
            " Requires a same-origin request. Sets whether the product is " +
            "offered on the site (`enabled`) and its `kind`. Records " +
            "`payment_product_updated` (detail: the product id) in the " +
            "audit log. Answers 404 `PaymentProductNotFound` and 409 " +
            "`ProductKindConflict` if another product is the tip product " +
            "already or a tip product would get roles or credits.",
        }),
      ),
    HttpApiEndpoint.put(
      "setPaymentProductRoles",
      "/admin/payments/products/:productId/roles",
      {
        params: ProductParams,
        payload: SetPaymentProductRolesPayload,
        success: AdminProduct,
        error: [PaymentProductNotFound, ProductKindConflict],
      },
    )
      .middleware(RequireSuperAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Set the roles of a payment product",
          description:
            "Requires `superAdmin` (it decides which roles money buys). " +
            "Answers with `Cache-Control: no-store`. Requires a " +
            "same-origin request. Replaces the roles the product grants " +
            "(only `foodPlanner` is purchasable). Records " +
            "`payment_product_roles_changed` (detail: the product id) in " +
            "the audit log. A product grants roles or credits, never both. " +
            "Answers 404 `PaymentProductNotFound` and 409 " +
            "`ProductKindConflict` if the product is the tip product or " +
            "already grants credits.",
        }),
      ),
    HttpApiEndpoint.put(
      "setPaymentProductCredits",
      "/admin/payments/products/:productId/credits",
      {
        params: ProductParams,
        payload: SetPaymentProductCreditsPayload,
        success: AdminProduct,
        error: [PaymentProductNotFound, ProductKindConflict],
      },
    )
      .middleware(RequireSuperAdmin)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Set the credits of a payment product",
          description:
            "Requires `superAdmin` (it decides what money buys). Answers " +
            "with `Cache-Control: no-store`. Requires a same-origin " +
            "request. Replaces the credits one purchase of the product " +
            "grants: at most one entry per feature, `quantity` 1 to 100 " +
            "(an empty list grants none). The change is not retroactive: " +
            "it applies to purchases started after it, and credits that " +
            "were granted before stay as they are: a purchase gets the " +
            "credits that were in force when its Checkout session was " +
            "created (changes are versioned, so a later change or removal " +
            "does not affect purchases already started). Only one-off purchases " +
            "grant credits, subscriptions never; a product that grants " +
            "credits can be bought repeatedly (no `AlreadyEntitled` " +
            "`purchased`). Records `payment_product_credits_changed` " +
            "(detail: the product id) in the audit log. Answers with " +
            "the updated product, 404 `PaymentProductNotFound` and 409 " +
            "`ProductKindConflict` if the product is the tip product " +
            "(tips grant nothing) or already grants roles: a product " +
            "grants roles or credits, never both.",
        }),
      ),
  )
  // Protects every endpoint above; added after them, so it runs first and
  // answers 401 before any role middleware answers 403.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Payment administration",
      description:
        "Payments, subscriptions, refunds and the products mirrored from " +
        "Stripe, for admins.",
    }),
  ) {}
