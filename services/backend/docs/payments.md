# Payments

Logged-in users pay through **Stripe**: subscriptions and one-off purchases
that grant roles, one-off purchases that grant credits (single uses of a
feature, see [Credits](#credits)), and tips that grant nothing. Stripe
hosts every page that touches money (Checkout, the Customer Portal), so no
card data reaches this server. Stripe is the source of truth; the `payments` domain
(`src/domains/payments/`) mirrors what it needs after every webhook.

## How it fits together

- **Catalog.** Products and prices are made in the Stripe dashboard. Their
  webhooks (or `POST /admin/payments/products/sync`) mirror them into
  `payment_products` and `payment_prices`. Ours are only the settings on top:
  whether a product is offered (`enabled`, off for new products), which one is
  the **tip product** (`kind = 'tip'`, at most one, never with roles or
  credits) and which roles or credits a product grants
  (`payment_product_roles`, `payment_product_credits`, superAdmins only).
  `GET /payments/catalog` (public) lists what is offered: enabled products
  active in Stripe, with their active prices that have a fixed amount.
- **Checkout.** `POST /payments/checkout` with `{ kind: "price", priceId }`
  (a subscription for a recurring price, else a one-off purchase, or a preset
  tip of the tip product) or `{ kind: "tip", amount }` (a custom tip within
  `TIP_MINIMUM`/`TIP_MAXIMUM`) answers the URL of a Stripe Checkout page. The
  user's Stripe customer is made on first use (`stripe_customers`, one per
  user and mode). A second subscription to a product they subscribe to (any
  status but canceled), or a second purchase of one they bought (paid or
  pending), is refused with 409 `AlreadyEntitled`, unless the product
  grants credits. Stripe sends the browser back to
  `/account?checkout=success` or `?checkout=cancelled`. Two checkouts
  started at the same moment can both succeed; the second subscription
  would then have to be cancelled by hand.
- **Customer Portal.** `POST /payments/portal` answers the URL of Stripe's
  portal for the user's customer (cancel, change the payment method,
  invoices); 404 `PaymentCustomerNotFound` before their first checkout.
- **Webhooks.** `POST /payments/stripe/webhook` checks the `Stripe-Signature`
  against the raw body (and its age, 5 minutes), stores the event id in
  `stripe_events` and queues the outbox message `payments.stripe-event`, all in
  one transaction; a repeated delivery is acknowledged and dropped. The
  consumer never trusts the event's object: it takes the ids it is about and
  fetches the **current** state from Stripe, so the order in which events
  arrive does not matter and a retry is harmless. An event of the other mode
  (test at a live endpoint) is ignored. Event ids are forgotten after 30
  days (Stripe retries for three).
- **Records.** `payment_subscriptions` (one row per Stripe subscription) and
  `payments` (one per completed one-off checkout and per paid subscription
  invoice, with refunds and disputes from its payment intent). Whose they are
  comes from the Stripe customer we made, and what was bought from the
  session's line item; never from metadata. An invoice without a
  subscription (a one-off checkout's, or one sent by hand) is no payment of
  its own.

Rows remember whether they were made in test or live mode (`livemode`), and
only the current mode's are read, so a database used with the sandbox keeps
working when the live key comes. At startup the backend also checks every
role held through a payment against the current mode, so roles that test
payments granted end with the switch to the live key.

## Roles granted by payments

Products grant **purchasable** roles only: `PurchasableRole` in the contract,
today just `foodPlanner`. The database refuses anything else
(`payment_product_roles_role_check`), so no mapping can sell `admin`.

After every change the domain recomputes what the user's subscriptions and
purchases entitle them to (`entitledRoles`) and hands it to
`ModerationCommands.syncPaidRoles`, in the same transaction:

| Paid with              | Grants its roles while                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| a subscription         | `active` or `trialing`. The first failed payment (`pastDue`) takes them away at once       |
| a one-off purchase     | `paid`, `partiallyRefunded` or `disputed`. A full refund or a lost dispute takes them away |
| a tip, an invoice only | nothing                                                                                    |

`user_roles.manual` tells the two kinds of grants apart: `true` for a role
someone granted (registration, a superAdmin, an operator), `false` for one
held only because of a payment. Payments grant with `manual = false` and only
ever revoke such rows, so a role a superAdmin granted survives the end of a
subscription. A superAdmin granting a role the user holds through a payment
makes it manual. A superAdmin revoking it removes it either way, until the
next payment event grants it again. Paid grants and revocations are in the
role change log with no actor. Changing a product's roles applies to
everyone who already pays for it.

## Credits

A one-off purchase can also grant **credits**: single uses of a feature,
today `mealPlan` (one meal plan each, see [food.md](food.md)). Code: the
`credits` domain (`src/domains/credits/`), table `feature_credits` (one row
per credit, migration 0021).

- **Products.** `payment_product_credits` says how many credits of which
  feature one purchase of a product grants (1 to 100), set by superAdmins
  (`PUT /admin/payments/products/:id/credits`, audited as
  `payment_product_credits_changed`). It is a history: each change adds a
  version per feature from `since` on (quantity 0 when a feature is
  removed), and a purchase gets what was in force when its Checkout
  session was made (`offerAt`), even if it is paid days later. Purchases
  keep the credits they got. A product grants roles or credits, never both
  (409 `ProductKindConflict`), so role products stay one-time purchases;
  subscriptions and tips never grant credits.
- **Granting.** With the roles, after every change: a purchase that grants
  access (as in the table above) gets its credits the first time, and gets
  back the ones that were revoked. Every other credit of the user is
  revoked: a full refund or a lost dispute, a purchase of the other mode,
  a deleted account. Revoking takes used credits too, so they no longer
  count, but they stay used. A webhook arriving twice grants nothing twice
  (`feature_credits_payment_id_feature_seq_key`).
- **The role.** While a user holds a credit of a feature that was not
  revoked, used or not, they hold the role that comes with it
  (`featureRoles`: `mealPlan` → `mealPlanBuyer`, `manual = false`), which
  lets them use what surrounds the feature (searching the food data,
  reading their plans). The credits limit the feature itself.
- **Using.** The feature's domain takes the user's oldest available credit
  in its own transaction (`CreditCommands.consume`, 402 `NoCreditsLeft`
  without one) and gives it back if what it paid for failed at no cost
  (`release`; for meal plans see [food.md](food.md)). Credits never
  expire.
- **Buying again.** A product that grants credits can be bought again and
  again: no 409 `AlreadyEntitled` for it.
- **Users** see their credits per feature (available and used) in
  `GET /payments/me`; the catalog shows what each product grants.

## Admins

- `GET /admin/payments`, `GET /admin/payments/subscriptions`: newest first,
  paged, filterable by user and status.
- `POST /admin/payments/:paymentId/refund` with an optional `amount` (else
  all that is left): Stripe refunds, the result is mirrored at once, and the
  audit log gets `payment_refunded`. The refund is checked first and sent to
  Stripe outside any transaction; a double click or a retry refunds once
  (idempotency key), though the audit log may then show it twice.
- `GET /admin/payments/products`, `POST …/products/sync`,
  `PATCH …/products/:id` (offered, tip product), `PUT …/products/:id/roles`
  and `PUT …/products/:id/credits` (superAdmins). Audited as
  `payment_catalog_synced`, `payment_product_updated`,
  `payment_product_roles_changed` and `payment_product_credits_changed`.
- `GET /admin/insights/payments`: revenue in the last 30 days and in total
  (paid minus refunded, per currency), refunds, monthly recurring revenue of
  the subscriptions that grant access, and their number.

## Account deletion

Deleting an account (see [account-deletion.md](account-deletion.md)) revokes
the user's credits and queues
`payments.cancel-subscriptions` for the user's Stripe customer: its live
subscriptions are cancelled at once, without proration or refund. Payments
and subscriptions stay, tied to the anonymised account, as records of the
business; Stripe keeps the customer and its invoices, which German law
requires for up to ten years. A deleted account never gets roles again.

## Setup

1. **Sandbox.** In the Stripe dashboard, use the sandbox (test mode) and
   copy the secret key into `STRIPE_SECRET_KEY` (`.env` locally, the
   environment file on the server; never the Nix store). The publishable
   key is not needed.
2. **Webhook.** Locally: `stripe listen --forward-to
localhost:3000/payments/stripe/webhook` prints a `whsec_…` for
   `STRIPE_WEBHOOK_SECRET`. On the server: Developers → Webhooks → add the
   endpoint `https://unhalteproblem.de/api/payments/stripe/webhook` (nginx
   allows it 512 KiB) and copy its signing secret. Send these events:
   `product.*`, `price.*`, `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `customer.subscription.*`,
   `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
   `charge.refund.updated`, `charge.dispute.*`.
3. **Customer Portal.** Settings → Billing → Customer portal: turn on
   cancelling subscriptions and updating payment methods, and save once
   (the portal answers an error until it is saved).
4. **Payment methods.** Settings → Payments → Payment methods: Checkout
   shows what is enabled there (cards, PayPal, Klarna, SEPA Direct Debit,
   Wero, …). SEPA and other delayed methods leave a purchase `pending` for
   a few days; it grants its roles once paid.
5. **Catalog.** Create products and prices in the dashboard, then in the
   admin panel (Payments → Products) enable them, mark the tip product, and
   (as a superAdmin) choose the roles or the credits per purchase.
6. **Invoices and VAT.** As a Kleinunternehmer (§19 UStG) leave
   `STRIPE_AUTOMATIC_TAX` off and put the §19 note into the invoice footer
   (Settings → Billing → Invoices, for subscriptions; `STRIPE_INVOICE_FOOTER`
   with `STRIPE_CHECKOUT_INVOICES=true` for one-off payments). Once VAT is
   due, set up Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`; Checkout then
   also asks for the billing address.

**Before going live**, the site needs an Impressum, a privacy policy that
names Stripe, and terms with the cancellation policy (Widerrufsbelehrung)
including the waiver for digital content delivered at once. Stripe also
needs the business details to activate the account.

## The website

The components are in `services/web/src/features/payments/` and are not
mounted yet: `PricingList` (products with buy and subscribe buttons),
`TipForm`, `MyPayments` (the user's credits, subscriptions and payments, the
Checkout result notice and `ManageBillingButton`), and the admin pages
`PaymentsAdminPage` and `PaymentProductsAdminPage`. To ship them, add the
first three to a page (the account page for `MyPayments`, since Checkout
returns there) and the admin pages to the routes and `sections` in
`features/admin/AdminApp.tsx`.

## Looking at it

```sql
-- Events that keep failing (Stripe unreachable, a bug)
SELECT id, attempts, last_error, dead_at FROM outbox
WHERE topic LIKE 'payments.%' ORDER BY id;

-- Who holds a role only because they pay
SELECT user_id, role, granted_at FROM user_roles WHERE NOT manual;
```
