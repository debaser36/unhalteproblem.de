import { Authentication } from "#Authentication";
import { AuditLogPage, AuditLogQuery } from "#domain/Audit";
import {
  ContactMessageId,
  ContactMessagePage,
  ContactMessagePageQuery,
} from "#domain/ContactMessage";
import { DatabaseOverview } from "#domain/Database";
import { OutboxMessage, OutboxMessageId, OutboxQuery } from "#domain/Outbox";
import { PaymentInsights } from "#domain/Payment";
import { ContactMessageNotFound } from "#errors/ContactMessageNotFound";
import { OutboxMessageNotFound } from "#errors/OutboxMessageNotFound";
import { RequireAdmin } from "#groups/Admin";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/** Path parameters of the endpoints for one outbox message. */
const OutboxMessageParams = { messageId: OutboxMessageId };

/** Path parameters of the endpoints for one contact message. */
const ContactMessageParams = { messageId: ContactMessageId };

// Shared by every endpoint description.
const adminRule = "Requires `admin`. Answers with `Cache-Control: no-store`.";

/**
 * What admins see of the backend's state: the database's catalog
 * statistics, the outbox, the audit log and the received contact messages.
 * Every endpoint requires a session (`Authentication`, 401) and `admin`
 * (`RequireAdmin`, 403 `Forbidden`), both on the group, so an endpoint added
 * here is protected without further ado. The two state-changing endpoints
 * also require `SameOrigin` (403 `Forbidden`) and write an audit log entry
 * in the same transaction as their change. The backend answers every
 * endpoint with `Cache-Control: no-store`.
 *
 * Middleware order: group middlewares are added after the endpoints, so
 * they run first: `Authentication` (401), then `RequireAdmin` (403), then
 * the endpoint's `SameOrigin` (403).
 */
export class AdminInsightsGroup extends HttpApiGroup.make("adminInsights")
  .add(
    HttpApiEndpoint.get("databaseOverview", "/admin/database", {
      success: DatabaseOverview,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Show the database overview",
        description:
          adminRule +
          " Returns the server's version and start time, the database's " +
          "name and size, its connections and cache hit ratio, the tables " +
          "of the `public` schema (largest first, by `totalBytes`) with " +
          "their sizes and statistics, and the applied migrations (by " +
          "`id`). Read from the server's catalog and statistics views " +
          "only, never from the tables' rows. Row counts are Postgres' " +
          "estimates.",
      }),
    ),
    HttpApiEndpoint.get("listOutbox", "/admin/outbox", {
      query: OutboxQuery,
      success: Schema.Array(OutboxMessage).annotate({
        description: "The matching outbox messages, newest first.",
      }),
      // An invalid `state` or `limit` is rejected by schema validation
      // (400). 401 and 403 come from the middlewares.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List outbox messages",
        description:
          adminRule +
          " Returns up to `limit` (1 to 200, default 100) outbox messages, " +
          "newest first (by `id`), without their payloads: `pending` ones " +
          "(not dead), `dead` ones (out of attempts), or `all` (the " +
          "default). Handled messages are deleted, so they never appear.",
      }),
    ),
    HttpApiEndpoint.post(
      "retryOutboxMessage",
      "/admin/outbox/:messageId/retry",
      {
        params: OutboxMessageParams,
        success: HttpApiSchema.NoContent.annotate({
          description: "The message is due again.",
        }),
        error: OutboxMessageNotFound,
      },
    )
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Retry an outbox message",
          description:
            adminRule +
            " Requires a same-origin request. Makes the message due at " +
            "once with a fresh set of attempts: `attempts` 0, " +
            "`availableAt` now, and no `lastError`, `deadAt` or " +
            "`lockedUntil`. Meant for dead messages, but works on pending " +
            "ones too; clearing the lease of a message a worker is " +
            "handling may run it twice, which outbox handlers tolerate. " +
            "Records `outbox_retried` (detail: the topic) in the audit " +
            "log. Answers 404 `OutboxMessageNotFound` for an unknown id, " +
            "which includes a message handled in the meantime.",
        }),
      ),
    HttpApiEndpoint.get("listAuditLog", "/admin/audit", {
      query: AuditLogQuery,
      success: AuditLogPage,
      // An invalid `limit`, `cursor`, `action` or `userId` is rejected by
      // schema validation (400). 401 and 403 come from the middlewares.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the audit log",
        description:
          adminRule +
          " Returns one page of the audit log, newest first (by `id`), " +
          "optionally only entries with one `action` and only entries " +
          "with `userId` as actor or target. Paged by cursor: " +
          "`nextCursor` is the position after the last returned entry " +
          "(null on the last page); pass it as `cursor`, with the same " +
          "filters, to get the next page. New entries sort to the front, " +
          "so they never shift the pages already read. A malformed " +
          "`cursor` is rejected with 400. `limit` is 1 to 100 (default " +
          "50).",
      }),
    ),
    HttpApiEndpoint.get("listContactMessages", "/admin/contact", {
      query: ContactMessagePageQuery,
      success: ContactMessagePage,
      // An invalid `limit` or `cursor` is rejected by schema validation
      // (400). 401 and 403 come from the middlewares.
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List contact messages",
        description:
          adminRule +
          " Returns one page of the messages received through the " +
          "contact form (`contact.submit`), newest first (by " +
          "`createdAt`, then `id`). Paged by cursor like `listAuditLog`. " +
          "Messages older than the retention period have been purged. " +
          "`limit` is 1 to 100 (default 50).",
      }),
    ),
    HttpApiEndpoint.delete(
      "deleteContactMessage",
      "/admin/contact/:messageId",
      {
        params: ContactMessageParams,
        success: HttpApiSchema.NoContent.annotate({
          description: "The message is deleted.",
        }),
        error: ContactMessageNotFound,
      },
    )
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Delete a contact message",
          description:
            adminRule +
            " Requires a same-origin request. Deletes the message " +
            "irreversibly and records `contact_message_deleted` in the " +
            "audit log (without detail: the message is personal data). " +
            "Answers 404 `ContactMessageNotFound` for an unknown id, " +
            "which includes a message already deleted or purged.",
        }),
      ),
    HttpApiEndpoint.get("paymentInsights", "/admin/insights/payments", {
      success: PaymentInsights,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Show the payment insights",
        description:
          adminRule +
          " Returns the revenue of the last 30 days and in total, the " +
          "refunded total and the monthly recurring revenue, each as one " +
          "amount per currency, the number of active subscriptions and " +
          "whether Stripe runs in live mode. Revenue is the amount minus " +
          "the amount refunded of the payments that are paid, partially " +
          "refunded or disputed.",
      }),
    ),
  )
  // Both protect every endpoint above. Added after them, so they run before
  // the endpoints' own middlewares; `Authentication` last, so it runs first
  // and answers 401 before `RequireAdmin` answers 403.
  .middleware(RequireAdmin)
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Admin insights",
      description:
        "The database overview, the outbox, the audit log and the " +
        "received contact messages, for admins.",
    }),
  ) {}
