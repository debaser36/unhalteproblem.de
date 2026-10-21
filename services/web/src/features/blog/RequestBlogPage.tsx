import { useAtomRefresh, useAtomSet } from "@effect/atom-react";
import {
  BlogLimits,
  type BlogRequest,
  blogEditorRole,
  type User,
} from "@unhalteproblem.de/api";
import { Exit } from "effect";
import { PenLine, Send, Undo2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { failureMessage } from "#api/errors.ts";
import { sessionAtom } from "#api/session.ts";
import { RequireUser } from "#app/RequireUser.tsx";
import { formatDate } from "#lib/format.ts";
import { Button, ButtonLink } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { Field, Input, Textarea } from "#ui/Field.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { useToast } from "#ui/toasts.ts";
import {
  blogRequestsKey,
  myBlogRequestsAtom,
  requestBlog,
  withdrawBlogRequest,
} from "./blogRequestAtoms.ts";
import { BlogRequestStatusBadge } from "./BlogRequestStatusBadge.tsx";

/** Asking for a subblog of one's own, and what became of earlier requests. */
export function RequestBlogPage() {
  return (
    <Container width="prose">
      <PageHeader path="~/blog/request" title="Start a blog">
        Want to write here? Tell us what your blog would be about. Once an admin
        approves it, the blog is created and you can write its posts.
      </PageHeader>
      <RequireUser>
        {(user) => (
          <AsyncView atom={myBlogRequestsAtom}>
            {(requests) => <Requests user={user} requests={requests} />}
          </AsyncView>
        )}
      </RequireUser>
    </Container>
  );
}

function Requests({
  user,
  requests,
}: {
  readonly user: User;
  readonly requests: ReadonlyArray<BlogRequest>;
}) {
  const refreshSession = useAtomRefresh(sessionAtom);
  // An approval grants the editor role; the session read before it doesn't
  // know yet, and the blog's editing pages go by the session.
  const missingRole = requests.some(
    (request) =>
      request.blog !== null &&
      !user.roles.includes(blogEditorRole(request.blog)),
  );
  useEffect(() => {
    if (missingRole) refreshSession();
  }, [missingRole, refreshSession]);

  const pending = requests.some((request) => request.status === "pending");
  return (
    <div className="space-y-8 pb-16">
      {!pending && <RequestForm />}
      {requests.length > 0 && (
        <section aria-labelledby="your-requests" className="space-y-3">
          <h2 id="your-requests" className="text-lg font-semibold text-fg">
            Your requests
          </h2>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </section>
      )}
    </div>
  );
}

function RequestForm() {
  const submit = useAtomSet(requestBlog, { mode: "promiseExit" });
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const exit = await submit({
      payload: { title: title.trim(), description: description.trim() },
      reactivityKeys: [blogRequestsKey],
    });
    setPending(false);
    const error = failureMessage(exit, {
      BlogRequestAlreadyPending: "You have a request waiting already.",
    });
    toast(
      error === undefined ? "success" : "error",
      error ?? "Request sent. An admin will look at it.",
    );
    if (Exit.isSuccess(exit)) {
      setTitle("");
      setDescription("");
    }
  };

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Title">
          {(control) => (
            <Input
              {...control}
              required
              maxLength={BlogLimits.blogTitleMaxLength}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Description"
          hint="What you'd write about. Shown on the blog's page once approved."
        >
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={BlogLimits.blogDescriptionMaxLength}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={title.trim() === ""}
          icon={<Send size={15} />}
        >
          Send request
        </Button>
      </form>
    </Card>
  );
}

function RequestCard({ request }: { readonly request: BlogRequest }) {
  const withdraw = useAtomSet(withdrawBlogRequest, { mode: "promiseExit" });
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const onWithdraw = async () => {
    setPending(true);
    const exit = await withdraw({
      params: { requestId: request.id },
      reactivityKeys: [blogRequestsKey],
    });
    setPending(false);
    const error = failureMessage(exit, {
      BlogRequestNotPending: "It has been decided meanwhile.",
    });
    toast(
      error === undefined ? "success" : "error",
      error ?? "Request withdrawn.",
    );
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-words text-fg">{request.title}</p>
          <p className="font-mono text-xs text-muted">
            asked {formatDate(request.createdAt)}
            {request.decidedAt !== null && (
              <> · decided {formatDate(request.decidedAt)}</>
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
      {request.status === "pending" && (
        <Button
          className="mt-4"
          size="sm"
          variant="ghost"
          loading={pending}
          icon={<Undo2 size={14} />}
          onClick={onWithdraw}
        >
          Withdraw
        </Button>
      )}
      {request.blog !== null && (
        <ButtonLink
          className="mt-4"
          size="sm"
          variant="primary"
          to={`/blog/${request.blog}/manage`}
          icon={<PenLine size={14} />}
        >
          Write in your blog
        </ButtonLink>
      )}
    </Card>
  );
}
