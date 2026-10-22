import { useAtomSet } from "@effect/atom-react";
import type { User } from "@unhalteproblem.de/api";
import { Exit } from "effect";
import { LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { NoIndex } from "#app/Seo.tsx";
import { ApiClient } from "#api/ApiClient.ts";
import { failureMessage } from "#api/errors.ts";
import { sessionKey } from "#api/session.ts";
import { RequireUser } from "#app/RequireUser.tsx";
import { Alert } from "#ui/Alert.tsx";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";

const deleteAccount = ApiClient.mutation("account", "deleteAccount");

export function AccountPage() {
  return (
    <Container width="prose">
      <NoIndex title="Your account" />
      <PageHeader path="~/account" title="Your account" />
      <RequireUser>{(user) => <Account user={user} />}</RequireUser>
    </Container>
  );
}

function Account({ user }: { readonly user: User }) {
  return (
    <div className="animate-fade-up space-y-6">
      <Card className="p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-mono text-muted">name</dt>
          <dd className="text-fg">{user.name ?? "—"}</dd>
          <dt className="font-mono text-muted">username</dt>
          <dd className="text-fg">{user.username ?? "—"}</dd>
          <dt className="font-mono text-muted">email</dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg">
            {user.email ?? "—"}
            {user.emailVerified === false && (
              <Badge tone="warning">unverified</Badge>
            )}
          </dd>
          <dt className="font-mono text-muted">roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {user.roles.map((role) => (
              <Badge
                key={role}
                tone={role === "normalUser" ? "neutral" : "accent"}
              >
                {role}
              </Badge>
            ))}
          </dd>
        </dl>
        <p className="mt-6 text-xs text-muted">
          Your profile comes from the login provider and is updated at every
          login.
        </p>
      </Card>

      <form method="post" action="/api/auth/logout">
        <Button type="submit" variant="secondary" icon={<LogOut size={15} />}>
          Log out
        </Button>
      </form>

      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const remove = useAtomSet(deleteAccount, { mode: "promiseExit" });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    setPending(true);
    setError(undefined);
    const exit = await remove({ reactivityKeys: [sessionKey] });
    setPending(false);
    if (Exit.isSuccess(exit)) {
      window.location.assign("/");
    } else {
      setOpen(false);
      setError(
        failureMessage(exit, {
          AccountDeletionNotAllowed:
            "A superAdmin cannot delete their account. Ask another superAdmin to revoke the role first.",
        }),
      );
    }
  };

  return (
    <Card className="border-danger/30 p-6">
      <h2 className="text-lg font-semibold text-fg">Delete account</h2>
      <p className="mt-2 text-sm text-fg-soft">
        Removes your profile and roles here and your account at the login
        provider. This cannot be undone.
      </p>
      {error !== undefined && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      <Button
        variant="danger"
        className="mt-4"
        icon={<Trash2 size={15} />}
        onClick={() => setOpen(true)}
      >
        Delete my account
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={confirm}>
              Delete forever
            </Button>
          </>
        }
      >
        You will be logged out everywhere, and you can't log in with this
        account again.
      </Dialog>
    </Card>
  );
}
