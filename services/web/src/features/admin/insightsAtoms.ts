import type {
  AuditAction,
  AuditCursor,
  ContactMessageCursor,
  OutboxState,
  UserId,
} from "@unhalteproblem.de/api";
import { ApiClient } from "#api/ApiClient.ts";

export const outboxKey = "admin/outbox";
export const auditKey = "admin/audit";
export const inboxKey = "admin/inbox";

export const databaseAtom = ApiClient.query(
  "adminInsights",
  "databaseOverview",
  {
    reactivityKeys: ["admin/database"],
  },
);

export const outboxAtom = (state: OutboxState) =>
  ApiClient.query("adminInsights", "listOutbox", {
    query: { state, limit: 100 },
    reactivityKeys: [outboxKey],
  });

export const auditPageAtom = (filter: {
  readonly cursor: AuditCursor | undefined;
  readonly action: AuditAction | undefined;
  readonly userId: UserId | undefined;
}) =>
  ApiClient.query("adminInsights", "listAuditLog", {
    query: {
      limit: 50,
      ...(filter.cursor === undefined ? {} : { cursor: filter.cursor }),
      ...(filter.action === undefined ? {} : { action: filter.action }),
      ...(filter.userId === undefined ? {} : { userId: filter.userId }),
    },
    reactivityKeys: [auditKey],
  });

export const inboxPageAtom = (cursor: ContactMessageCursor | undefined) =>
  ApiClient.query("adminInsights", "listContactMessages", {
    query: cursor === undefined ? { limit: 50 } : { limit: 50, cursor },
    reactivityKeys: [inboxKey],
  });

export const retryOutboxMessage = ApiClient.mutation(
  "adminInsights",
  "retryOutboxMessage",
);
export const deleteContactMessage = ApiClient.mutation(
  "adminInsights",
  "deleteContactMessage",
);
