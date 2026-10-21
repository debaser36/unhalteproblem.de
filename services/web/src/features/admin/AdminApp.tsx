import {
  Activity,
  BookOpen,
  Database,
  FolderGit2,
  Inbox,
  ScrollText,
  Users,
} from "lucide-react";
import { NavLink, Route, Routes } from "react-router";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { RequireUser } from "#app/RequireUser.tsx";
import { cn } from "#lib/cn.ts";
import { Container } from "#ui/Container.tsx";
import { AuditLogPage } from "./AuditLogPage.tsx";
import { BlogsAdminPage } from "./BlogsAdminPage.tsx";
import { ContactInboxPage } from "./ContactInboxPage.tsx";
import { DatabasePage } from "./DatabasePage.tsx";
import { OutboxPage } from "./OutboxPage.tsx";
import { ProjectsAdminPage } from "./ProjectsAdminPage.tsx";
import { UserPage } from "./UserPage.tsx";
import { UsersPage } from "./UsersPage.tsx";

// Absolute on purpose: the panel is mounted on the splat route `admin/*`, and
// React Router v7 resolves relative links there against the whole current URL,
// so `to: "users"` on /admin/users would lead to /admin/users/users.
const sections = [
  { to: "/admin", label: "Database", icon: Database, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/blogs", label: "Blogs", icon: BookOpen },
  { to: "/admin/projects", label: "Projects", icon: FolderGit2 },
  { to: "/admin/outbox", label: "Outbox", icon: Activity },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/admin/inbox", label: "Inbox", icon: Inbox },
] as const;

/**
 * The admin panel, for users with the `admin` role. The backend checks the
 * role on every request; hiding the panel from others is only a courtesy.
 */
export function AdminApp() {
  return (
    <RequireUser role="admin">
      {() => (
        <Container width="wide" className="pt-8">
          <p className="mb-6 font-mono text-sm text-muted">
            <span className="text-danger">root</span>@unhalteproblem:
            <span className="text-accent-2">/admin</span> #
          </p>
          <div className="grid gap-8 lg:grid-cols-[13rem_1fr]">
            <nav
              aria-label="Admin"
              className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
            >
              {sections.map(({ to, label, icon: Icon, ...rest }) => (
                <NavLink
                  key={label}
                  to={to}
                  end={"end" in rest}
                  className={({ isActive }) =>
                    cn(
                      "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-accent-soft text-accent"
                        : "text-fg-soft hover:bg-surface-2 hover:text-fg",
                    )
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="min-w-0">
              <Routes>
                <Route index element={<DatabasePage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="users/:userId" element={<UserPage />} />
                <Route path="blogs" element={<BlogsAdminPage />} />
                <Route path="projects" element={<ProjectsAdminPage />} />
                <Route path="outbox" element={<OutboxPage />} />
                <Route path="audit" element={<AuditLogPage />} />
                <Route path="inbox" element={<ContactInboxPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </div>
          </div>
        </Container>
      )}
    </RequireUser>
  );
}
