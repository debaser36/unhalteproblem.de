import { useAtomValue } from "@effect/atom-react";
import { LayoutDashboard, LogIn, LogOut, PenSquare, User } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { blogOfEditorRole } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { currentPath, hasRole, loginUrl, sessionAtom } from "#api/session.ts";
import { buttonClass } from "#ui/buttonClass.ts";
import { Menu, MenuButton, MenuLink, MenuSeparator } from "#ui/Menu.tsx";
import { Skeleton } from "#ui/Skeleton.tsx";

/** Login link, or the logged-in user's menu. */
export function UserMenu() {
  const session = useAtomValue(sessionAtom);

  if (AsyncResult.isInitial(session)) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }
  const user = AsyncResult.isSuccess(session) ? session.value?.user : null;
  if (user === null || user === undefined) {
    return (
      <a
        href={loginUrl(currentPath())}
        className={buttonClass("secondary", "sm", "font-mono")}
      >
        <LogIn size={15} />
        <span className="hidden sm:inline">login</span>
      </a>
    );
  }

  const displayName = user.name ?? user.username ?? "you";
  const editorOf = user.roles.flatMap((role) =>
    Option.toArray(blogOfEditorRole(role)),
  );

  return (
    <Menu
      label="Account menu"
      trigger={
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-accent-soft font-mono text-sm font-semibold text-accent uppercase">
          {displayName.slice(0, 1)}
        </span>
      }
    >
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-fg">{displayName}</p>
        {user.email !== undefined && (
          <p className="truncate text-xs text-muted">{user.email}</p>
        )}
      </div>
      <MenuSeparator />
      <MenuLink to="/account" icon={<User size={15} />}>
        Account
      </MenuLink>
      {editorOf.map((blog) => (
        <MenuLink
          key={blog}
          to={`/blog/${blog}/manage`}
          icon={<PenSquare size={15} />}
        >
          Write in {blog}
        </MenuLink>
      ))}
      {hasRole(user, "admin") && (
        <MenuLink to="/admin" icon={<LayoutDashboard size={15} />}>
          Admin panel
        </MenuLink>
      )}
      <MenuSeparator />
      {/* A form post: the backend ends the session and redirects to Keycloak. */}
      <form method="post" action="/api/auth/logout">
        <MenuButton type="submit" icon={<LogOut size={15} />}>
          Log out
        </MenuButton>
      </form>
    </Menu>
  );
}
