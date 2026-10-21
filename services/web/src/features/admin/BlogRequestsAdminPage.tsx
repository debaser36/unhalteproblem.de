import { useAtomSet } from "@effect/atom-react";
import {
  type AdminBlogRequest,
  BlogRequestLimits,
  type BlogRequestStatus,
  BlogSlug,
  BlogSlugMaxLength,
} from "@unhalteproblem.de/api";
import { Exit, Option, Schema } from "effect";
import { Check, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ApiClient } from "#api/ApiClient.ts";
import { AsyncView } from "#api/AsyncView.tsx";
import { failureMessage } from "#api/errors.ts";
import { blogsKey } from "#features/blog/blogAtoms.ts";
import { blogRequestsKey } from "#features/blog/blogRequestAtoms.ts";
import { BlogRequestStatusBadge } from "#features/blog/BlogRequestStatusBadge.tsx";
import { formatDateTime } from "#lib/format.ts";
import { slugify } from "#lib/slug.ts";
import { cn } from "#lib/cn.ts";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Field, Input, Textarea } from "#ui/Field.tsx";
import { useToast } from "#ui/toasts.ts";
import { AdminHeading } from "./AdminHeading.tsx";
import { usersKey } from "./adminAtoms.ts";
import { auditKey } from "./insightsAtoms.ts";

const requestsAtom = (status: BlogRequestStatus | undefined) =>
  ApiClient.query("blogRequestAdmin", "listBlogRequests", {
    query: status === undefined ? { limit: 100 } : { limit: 100, status },
    reactivityKeys: [blogRequestsKey],
  });

const approveRequest = ApiClient.mutation(
  "blogRequestAdmin",
  "approveBlogRequest",
);
const rejectRequest = ApiClient.mutation(
  "blogRequestAdmin",
  "rejectBlogRequest",
);
const decodeSlug = Schema.decodeUnknownOption(BlogSlug);

// What a decision makes stale besides the requests: approval creates a blog
// and grants a role; both are audited.
const decided = [blogRequestsKey, blogsKey, usersKey, auditKey];

const filters = [
  { label: "Pending", status: "pending" },
  { label: "All", status: undefined },
] as const;

export function BlogRequestsAdminPage() {
  const [status, setStatus] = useState<BlogRequestStatus | undefined>(
    "pending",
  );
  return (
    <>
      <AdminHeading
        title="Blog requests"
        actions={filters.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={filter.status === status ? "primary" : "ghost"}
            onClick={() => setStatus(filter.status)}
          >
            {filter.label}
          </Button>
        ))}
      >
        Users asking for a blog of their own, newest first. Approving creates
        the blog and makes the user its editor.
      </AdminHeading>
      <AsyncView atom={requestsAtom(status)}>
        {(requests) =>
          requests.length === 0 ? (
            <EmptyState
              title={status === "pending" ? "Nothing to decide." : "None yet."}
            />
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
            </div>
          )
        }
      </AsyncView>
    </>
  );
}

function RequestCard({ request }: { readonly request: AdminBlogRequest }) {
  const { requester } = request;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-words text-fg">{request.title}</p>
          <p className="font-mono text-xs text-muted">
            by{" "}
            <Link
              to={`/admin/users/${requester.id}`}
              className={cn(
                "hover:text-accent",
                requester.deleted && "line-through",
              )}
            >
              {requester.deleted
                ? "deleted account"
                : (requester.name ?? requester.username ?? requester.id)}
            </Link>{" "}
            · {formatDateTime(request.createdAt)}
            {request.blog !== null && (
              <>
                {" "}
                ·{" "}
                <Link to={`/blog/${request.blog}`} className="text-accent">
                  {request.blog}
                </Link>
              </>
            )}
          </p>
        </div>
        <BlogRequestStatusBadge status={request.status} />
      </div>
      {request.description !== "" && (
        <p className="mt-3 text-sm whitespace-pre-wrap text-fg-soft">
          {request.description}
        </p>
      )}
      {request.reason !== null && (
        <p className="mt-3 text-sm whitespace-pre-wrap text-fg-soft">
          <span className="font-mono text-danger">reason:</span>{" "}
          {request.reason}
        </p>
      )}
      {request.status === "pending" && <Decision request={request} />}
    </Card>
  );
}

function Decision({ request }: { readonly request: AdminBlogRequest }) {
  const approve = useAtomSet(approveRequest, { mode: "promiseExit" });
  const reject = useAtomSet(rejectRequest, { mode: "promiseExit" });
  const toast = useToast();
  const [slug, setSlug] = useState(() =>
    slugify(request.title, BlogSlugMaxLength),
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const validSlug = Option.isSome(decodeSlug(slug));

  const messages = {
    BlogRequestNotPending: "It has been decided or withdrawn meanwhile.",
    BlogRequestNotFound: "This request doesn't exist anymore.",
    BlogSlugTaken: "A blog with this slug exists already.",
    UserNotFound: "The user has deleted their account.",
    Forbidden: "You can't decide your own request.",
  };

  const onApprove = async (event: FormEvent) => {
    event.preventDefault();
    if (!validSlug) return;
    setPending(true);
    const exit = await approve({
      params: { requestId: request.id },
      payload: { slug },
      reactivityKeys: decided,
    });
    setPending(false);
    const error = failureMessage(exit, messages);
    toast(
      error === undefined ? "success" : "error",
      error ?? `Created ${slug}.`,
    );
  };

  const onReject = async () => {
    setPending(true);
    const trimmed = reason.trim();
    const exit = await reject({
      params: { requestId: request.id },
      payload: trimmed === "" ? {} : { reason: trimmed },
      reactivityKeys: decided,
    });
    setPending(false);
    const error = failureMessage(exit, messages);
    toast(error === undefined ? "success" : "error", error ?? "Rejected.");
    if (Exit.isSuccess(exit)) setRejecting(false);
  };

  return (
    <>
      <form
        onSubmit={onApprove}
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        {/* Approval would fail: nobody is left to make the editor. */}
        {!request.requester.deleted && (
          <>
            <Field
              label="Slug"
              className="min-w-56 flex-1"
              hint="In URLs and in the editor role. Can't be changed later."
              error={
                slug !== "" && !validSlug
                  ? "a-z, 0-9 and single hyphens"
                  : undefined
              }
            >
              {(control) => (
                <Input
                  {...control}
                  required
                  maxLength={BlogSlugMaxLength}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={!validSlug}
              icon={<Check size={15} />}
            >
              Approve
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          icon={<X size={15} />}
          onClick={() => setRejecting(true)}
        >
          Reject
        </Button>
      </form>
      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject this request?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={onReject}>
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)" hint="The user sees it.">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={BlogRequestLimits.reasonMaxLength}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}
