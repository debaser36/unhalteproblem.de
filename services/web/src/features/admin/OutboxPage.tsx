import { useAtomSet } from "@effect/atom-react";
import type { OutboxMessage, OutboxState } from "@unhalteproblem.de/api";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { failureMessage } from "#api/errors.ts";
import { cn } from "#lib/cn.ts";
import { formatDateTime } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { useToast } from "#ui/Toast.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import {
  auditKey,
  outboxAtom,
  outboxKey,
  retryOutboxMessage,
} from "./insightsAtoms.ts";

const states: ReadonlyArray<OutboxState> = ["all", "pending", "dead"];

export function OutboxPage() {
  const [state, setState] = useState<OutboxState>("all");
  return (
    <>
      <AdminHeading title="Outbox">
        Side effects that must not get lost (mails, deleting Keycloak users),
        handled in the background with retries. Payloads are not shown.
      </AdminHeading>
      <div role="tablist" aria-label="State" className="mb-4 flex gap-1.5">
        {states.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state === value}
            onClick={() => setState(value)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-sm",
              state === value
                ? "bg-accent-soft text-accent"
                : "text-fg-soft hover:bg-surface-2",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      <AsyncView atom={outboxAtom(state)}>
        {(messages) =>
          messages.length === 0 ? (
            <EmptyState title="Nothing in the outbox.">
              Everything has been handled.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Message</Th>
                  <Th>State</Th>
                  <Th className="text-right">Attempts</Th>
                  <Th>Last error</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <Row key={message.id} message={message} />
                ))}
              </tbody>
            </Table>
          )
        }
      </AsyncView>
    </>
  );
}

function Row({ message }: { readonly message: OutboxMessage }) {
  const retry = useAtomSet(retryOutboxMessage, { mode: "promiseExit" });
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const failing = message.deadAt !== null || message.attempts > 0;

  const onRetry = async () => {
    setPending(true);
    const exit = await retry({
      params: { messageId: message.id },
      reactivityKeys: [outboxKey, auditKey],
    });
    setPending(false);
    const error = failureMessage(exit, {
      OutboxMessageNotFound: "The message is gone: it was handled meanwhile.",
    });
    toast(error === undefined ? "success" : "error", error ?? "Retrying now.");
  };

  return (
    <tr className="hover:bg-surface-2/50">
      <Td>
        <p className="font-mono text-xs text-fg">{message.topic}</p>
        <p className="text-xs text-muted">
          #{message.id} · {formatDateTime(message.createdAt)}
        </p>
      </Td>
      <Td className="whitespace-nowrap">
        {message.deadAt !== null ? (
          <Badge tone="danger">dead</Badge>
        ) : message.lockedUntil !== null ? (
          <Badge tone="info">running</Badge>
        ) : (
          <Badge tone={message.attempts > 0 ? "warning" : "neutral"}>
            due {formatDateTime(message.availableAt)}
          </Badge>
        )}
      </Td>
      <Td className="text-right font-mono text-xs tabular-nums">
        {message.attempts}
      </Td>
      <Td className="max-w-xs font-mono text-xs break-words text-danger">
        {message.lastError ?? <span className="text-muted">—</span>}
      </Td>
      <Td className="text-right">
        {failing && (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            icon={<RotateCcw size={14} />}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </Td>
    </tr>
  );
}
