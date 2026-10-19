import { useAtomValue } from "@effect/atom-react";
import type { Role, User } from "@unhalteproblem.de/api";
import { LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { AsyncResult } from "effect/reactivity";
import { currentPath, loginUrl, sessionAtom } from "#api/session.ts";
import { Alert } from "#ui/Alert.tsx";
import { buttonClass } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { Loading } from "#ui/Spinner.tsx";

/**
 * Renders `children` for a logged-in user (holding `role`, if given), and
 * a login prompt or a refusal otherwise. Only a convenience for the UI: the
 * backend checks every request itself.
 */
export function RequireUser({
  role,
  children,
}: {
  readonly role?: Role;
  readonly children: (user: User) => ReactNode;
}) {
  const session = useAtomValue(sessionAtom);
  if (AsyncResult.isInitial(session)) return <Loading />;
  if (AsyncResult.isFailure(session)) {
    return (
      <Container width="prose" className="py-16">
        <Alert tone="danger" title="The server is not answering.">
          Please try again in a moment.
        </Alert>
      </Container>
    );
  }
  const user = session.value?.user;
  if (user === undefined) {
    return (
      <Container width="prose" className="space-y-6 py-24 font-mono">
        <p className="text-sm text-muted">
          <span className="text-danger">permission denied</span>: please log in
        </p>
        <a href={loginUrl(currentPath())} className={buttonClass("primary")}>
          <LogIn size={16} /> Log in
        </a>
      </Container>
    );
  }
  if (role !== undefined && !user.roles.includes(role)) {
    return (
      <Container width="prose" className="space-y-3 py-24 font-mono">
        <p className="text-6xl font-semibold text-fg">403</p>
        <p className="text-fg-soft">
          This area needs the role <span className="text-accent">{role}</span>.
        </p>
      </Container>
    );
  }
  return children(user);
}
