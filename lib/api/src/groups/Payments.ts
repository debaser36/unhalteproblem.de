import { Authentication } from "#Authentication";
import {
  Catalog,
  CheckoutRequest,
  MyPayments,
  RedirectUrl,
} from "#domain/Payment";
import { AlreadyEntitled } from "#errors/AlreadyEntitled";
import { InvalidWebhookSignature } from "#errors/InvalidWebhookSignature";
import { PaymentCustomerNotFound } from "#errors/PaymentCustomerNotFound";
import { PaymentPriceNotFound } from "#errors/PaymentPriceNotFound";
import { PaymentProviderFailed } from "#errors/PaymentProviderFailed";
import { PaymentsUnavailable } from "#errors/PaymentsUnavailable";
import { TipAmountOutOfRange } from "#errors/TipAmountOutOfRange";
import { TipsUnavailable } from "#errors/TipsUnavailable";
import { LargeBody } from "#LargeBody";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * What the website offers for sale: the products, their prices and the tip
 * offer.
 *
 * Public on purpose (no `Authentication`): the prices are shown to anonymous
 * visitors before they log in, and the catalog holds nothing personal. The
 * backend answers with `Cache-Control: public, max-age=60`.
 */
export class PaymentCatalogGroup extends HttpApiGroup.make("paymentCatalog")
  .add(
    HttpApiEndpoint.get("getCatalog", "/payments/catalog", {
      success: Catalog,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get the payment catalog",
        description:
          "Public. Returns the enabled products that are active in Stripe " +
          "with the roles and credits they grant and their active prices that have a " +
          "fixed amount, and the tip offer (null if no tip product is " +
          "enabled). Answers with `Cache-Control: public, max-age=60`.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Payment catalog",
      description: "The products, prices and tip offer that can be bought.",
    }),
  ) {}

// Shared by every endpoint description.
const paymentsRule =
  "Requires a session. Answers with `Cache-Control: no-store`.";

/**
 * Paying: Stripe-hosted Checkout to buy a product or tip, Stripe's Customer
 * Portal to manage payment methods, subscriptions and invoices, and the
 * caller's own subscriptions and payments. Every endpoint requires a session
 * (`Authentication`, 401), on the group; the POSTs also require `SameOrigin`
 * (403 `Forbidden`). The backend answers every endpoint with
 * `Cache-Control: no-store`.
 *
 * Paid access is granted by Stripe's webhooks (`stripeWebhook`), not by the
 * browser's return from Checkout, so the roles can arrive a moment later.
 */
export class PaymentsGroup extends HttpApiGroup.make("payments")
  .add(
    HttpApiEndpoint.post("startCheckout", "/payments/checkout", {
      payload: CheckoutRequest,
      success: RedirectUrl,
      error: [
        PaymentsUnavailable,
        PaymentProviderFailed,
        PaymentPriceNotFound,
        AlreadyEntitled,
        TipAmountOutOfRange,
        TipsUnavailable,
      ],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Start a checkout",
          description:
            paymentsRule +
            " Requires a same-origin request. Creates a Stripe Checkout " +
            "session for a price (`kind: price`) or a custom tip (`kind: " +
            "tip`) and answers with the URL to send the browser to. " +
            "Answers 404 `PaymentPriceNotFound` for an unknown, inactive " +
            "or not offered price, 409 `AlreadyEntitled` if the caller " +
            "already has a live subscription or, unless the product " +
            "grants credits (those can be bought repeatedly), a paid or " +
            "pending purchase of the product, 400 `TipAmountOutOfRange`, 404 " +
            "`TipsUnavailable` if there is no tip product, 503 " +
            "`PaymentsUnavailable` if Stripe is not configured and 502 " +
            "`PaymentProviderFailed` if Stripe fails.",
        }),
      ),
    HttpApiEndpoint.post("openBillingPortal", "/payments/portal", {
      success: RedirectUrl,
      error: [
        PaymentsUnavailable,
        PaymentProviderFailed,
        PaymentCustomerNotFound,
      ],
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Open the billing portal",
          description:
            paymentsRule +
            " Requires a same-origin request. Creates a Stripe Customer " +
            "Portal session and answers with the URL to send the browser " +
            "to. Answers 404 `PaymentCustomerNotFound` if the caller has " +
            "not bought anything yet, 503 `PaymentsUnavailable` and 502 " +
            "`PaymentProviderFailed`.",
        }),
      ),
    HttpApiEndpoint.get("myPayments", "/payments/me", {
      success: MyPayments,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the caller's payments",
        description:
          paymentsRule +
          " Returns the caller's subscriptions and payments, newest first, " +
          "and their credit balances (one per feature they ever got " +
          "credits for; revoked credits are not counted).",
      }),
    ),
  )
  // Protects every endpoint above; added after them so it runs first.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Payments",
      description:
        "Checkout, billing portal and the caller's own subscriptions and " +
        "payments.",
    }),
  ) {}

/**
 * The raw body of a Stripe webhook as text. Stripe signs the exact bytes, so
 * the backend verifies the signature over this string before it parses the
 * JSON. Stripe sends `Content-Type: application/json; charset=utf-8`.
 */
const WebhookBody = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: "application/json" }),
).annotate({
  description: "The raw JSON body of the Stripe event, exactly as sent.",
});

/**
 * Stripe's webhooks: Stripe tells us about payments, subscriptions and
 * products, and the backend grants or revokes roles and mirrors the catalog.
 *
 * Public on purpose (no `Authentication`): Stripe calls it server-to-server,
 * without a browser or cookie. The request is authenticated by the
 * `Stripe-Signature` header, an HMAC over the raw body, which the handler
 * verifies before it does anything.
 */
export class PaymentWebhooksGroup extends HttpApiGroup.make("paymentWebhooks")
  .add(
    HttpApiEndpoint.post("stripeWebhook", "/payments/stripe/webhook", {
      headers: { "stripe-signature": Schema.String },
      payload: WebhookBody,
      success: HttpApiSchema.Empty(200).annotate({
        description: "The event is handled, or was handled before.",
      }),
      error: [InvalidWebhookSignature, PaymentsUnavailable],
    })
      .middleware(LargeBody)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Receive a Stripe webhook",
          description:
            "Called by Stripe. Verifies the `Stripe-Signature` header " +
            "against the raw body, and handles the event once (repeated " +
            "deliveries are ignored). Answers 200, 400 " +
            "`InvalidWebhookSignature` for a missing or wrong signature, " +
            "or 503 `PaymentsUnavailable` if Stripe is not configured.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Payment webhooks",
      description: "Events sent by Stripe, authenticated by their signature.",
    }),
  ) {}
