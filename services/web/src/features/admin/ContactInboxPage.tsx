import type {
  ContactMessageCursor,
  ReceivedContactMessage,
} from "@unhalteproblem.de/api";
import { Mail, Trash2 } from "lucide-react";
import { useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { useAction } from "#api/useAction.ts";
import { formatDateTime } from "#lib/format.ts";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import {
  auditKey,
  deleteContactMessage,
  inboxKey,
  inboxPageAtom,
} from "./insightsAtoms.ts";

export function ContactInboxPage() {
  const [cursors, setCursors] = useState<
    ReadonlyArray<ContactMessageCursor | undefined>
  >([undefined]);
  return (
    <>
      <AdminHeading title="Inbox">
        Messages from the contact form, newest first. They are also mailed to
        you, and deleted automatically after the retention period.
      </AdminHeading>
      <div className="space-y-3">
        {cursors.map((cursor, index) => (
          <AsyncView key={index} atom={inboxPageAtom(cursor)}>
            {(page) => (
              <>
                {index === 0 && page.messages.length === 0 && (
                  <EmptyState title="No messages." />
                )}
                {page.messages.map((message) => (
                  <MessageCard key={message.id} message={message} />
                ))}
                {index === cursors.length - 1 && page.nextCursor !== null && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setCursors((all) => [
                          ...all,
                          page.nextCursor ?? undefined,
                        ])
                      }
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </AsyncView>
        ))}
      </div>
    </>
  );
}

function MessageCard({
  message,
}: {
  readonly message: ReceivedContactMessage;
}) {
  const remove = useAction(deleteContactMessage, {
    success: "Message deleted.",
    errors: { ContactMessageNotFound: "It was deleted already." },
  });
  const [confirm, setConfirm] = useState(false);

  const onDelete = async () => {
    await remove.run({
      params: { messageId: message.id },
      reactivityKeys: [inboxKey, auditKey],
    });
    setConfirm(false);
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-fg">{message.name}</p>
          <p className="text-sm text-accent-2">{message.email}</p>
        </div>
        <p className="font-mono text-xs text-muted">
          {formatDateTime(message.createdAt)}
        </p>
      </div>
      <p className="mt-4 text-sm whitespace-pre-wrap text-fg-soft">
        {message.message}
      </p>
      <div className="mt-4 flex gap-2">
        <a
          href={`mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent("Re: your message on unhalteproblem.de")}`}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 text-sm text-fg hover:border-accent/60"
        >
          <Mail size={14} /> Reply
        </a>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} />}
          onClick={() => setConfirm(true)}
        >
          Delete
        </Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this message?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.pending}
              onClick={onDelete}
            >
              Delete
            </Button>
          </>
        }
      >
        The message from {message.name} will be gone for good.
      </Dialog>
    </Card>
  );
}
