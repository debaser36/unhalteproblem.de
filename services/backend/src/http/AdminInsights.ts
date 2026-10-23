import { Api, AuditLogEntryId, OutboxMessageId } from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { AuditQueries } from "#domains/audit/AuditQueries";
import { ContactCommands } from "#domains/contact/ContactCommands";
import { ContactQueries } from "#domains/contact/ContactQueries";
import { OperationsCommands } from "#domains/operations/OperationsCommands";
import { OperationsQueries } from "#domains/operations/OperationsQueries";
import { PaymentQueries } from "#domains/payments/PaymentQueries";
import { noStore } from "./CacheControl.ts";

/**
 * The admin panel's insights: the database, the outbox, the audit log,
 * the stored contact messages and the payment figures. The group's
 * `RequireAdmin` provides the proof every query and command requires;
 * nothing here may be cached.
 */
export const AdminInsightsHandlers = HttpApiBuilder.group(
  Api,
  "adminInsights",
  Effect.fn(function* (handlers) {
    const operations = yield* OperationsQueries;
    const operationCommands = yield* OperationsCommands;
    const audit = yield* AuditQueries;
    const contacts = yield* ContactQueries;
    const contactCommands = yield* ContactCommands;
    const payments = yield* PaymentQueries;
    return handlers
      .handle("paymentInsights", () => payments.insights.pipe(noStore))
      .handle("databaseOverview", () =>
        operations.databaseOverview.pipe(
          Effect.map(({ facts, tables, migrations }) => ({
            postgresVersion: facts.postgresVersion,
            databaseName: facts.databaseName,
            databaseBytes: facts.databaseBytes,
            startedAt: facts.startedAt,
            connections: {
              active: facts.active,
              idle: facts.idle,
              total: facts.total,
              max: facts.max,
            },
            cacheHitRatio: facts.cacheHitRatio,
            tables,
            migrations,
          })),
          noStore,
        ),
      )
      .handle("listOutbox", ({ query }) =>
        operations.outbox(query.state, query.limit).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({ ...row, id: OutboxMessageId.make(row.id) })),
          ),
          noStore,
        ),
      )
      .handle("retryOutboxMessage", ({ params }) =>
        operationCommands.retryOutboxMessage(params.messageId).pipe(noStore),
      )
      .handle("listAuditLog", ({ query }) =>
        audit
          .page({
            limit: query.limit,
            before: Option.map(
              Option.fromUndefinedOr(query.cursor),
              ({ id }) => id,
            ),
            action: Option.fromUndefinedOr(query.action),
            userId: Option.fromUndefinedOr(query.userId),
          })
          .pipe(
            Effect.map(({ entries, next }) => ({
              entries: entries.map((entry) => ({
                ...entry,
                id: AuditLogEntryId.make(entry.id),
              })),
              nextCursor: Option.getOrNull(
                Option.map(next, (id) => ({ id: AuditLogEntryId.make(id) })),
              ),
            })),
            noStore,
          ),
      )
      .handle("listContactMessages", ({ query }) =>
        contacts
          .page({
            limit: query.limit,
            after: Option.fromUndefinedOr(query.cursor),
          })
          .pipe(
            Effect.map(({ messages, next }) => ({
              messages: messages.map((message) => ({
                id: message.id,
                name: message.name,
                email: message.email,
                message: message.message,
                createdAt: message.createdAt,
              })),
              nextCursor: Option.getOrNull(next),
            })),
            noStore,
          ),
      )
      .handle("deleteContactMessage", ({ params }) =>
        contactCommands.delete(params.messageId).pipe(noStore),
      );
  }),
);
