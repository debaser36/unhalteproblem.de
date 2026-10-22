import { useAtomValue } from "@effect/atom-react";
import {
  type AdminUserDetails,
  BlogSlug,
  blogEditorRole,
  type Role,
  RestrictionNoteMaxLength,
  UserId,
} from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { ArrowLeft, Ban, Plus, ShieldCheck, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { AsyncResult } from "effect/reactivity";
import { AsyncView } from "#api/AsyncView.tsx";
import { useAction } from "#api/useAction.ts";
import { hasRole, sessionKey, userAtom } from "#api/session.ts";
import { NotFoundPage } from "#app/NotFoundPage.tsx";
import { blogsAtom } from "#features/blog/blogAtoms.ts";
import { formatDateTime } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Field, Input, Select, Textarea } from "#ui/Field.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import {
  grantRole,
  liftRestriction,
  restrictUser,
  revokeRole,
  userDetailsAtom,
  usersKey,
} from "./adminAtoms.ts";

const decodeUserId = Schema.decodeUnknownOption(UserId);

export function UserPage() {
  const userId = decodeUserId(useParams().userId);
  if (Option.isNone(userId)) return <NotFoundPage what="user" />;
  return (
    <AsyncView
      atom={userDetailsAtom(userId.value)}
      failure={(tag) =>
        tag === "UserNotFound" ? <NotFoundPage what="user" /> : undefined
      }
    >
      {(user) => <UserDetails user={user} />}
    </AsyncView>
  );
}

const messages = {
  RestrictionNotAllowed:
    "Not allowed: nobody acts on themselves, and only a superAdmin acts on admins.",
  AlreadyRestricted: "The account is restricted already.",
  NotRestricted: "The account is not restricted.",
  RoleChangeNotAllowed:
    "Not allowed: nobody revokes their own superAdmin, and the last superAdmin keeps it.",
  BlogNotFound: "There is no blog with that slug. Create it first.",
};

/** The keys to refresh after a change: the user, and the own session (own roles may change). */
const changed = { reactivityKeys: [usersKey, sessionKey] };

function UserDetails({ user }: { readonly user: AdminUserDetails }) {
  const me = useAtomValue(userAtom);
  const isSuperAdmin = hasRole(me, "superAdmin");
  const name = user.name ?? user.username ?? "unnamed";
  return (
    <>
      <Link
        to=".."
        relative="path"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft size={14} /> all users
      </Link>
      <AdminHeading title={user.deletedAt === null ? name : "Deleted account"}>
        {user.email ?? "no email"}
        {user.emailVerified ? " · verified" : " · not verified"}
      </AdminHeading>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-fg">Profile</h2>
          <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-mono text-muted">id</dt>
            <dd className="font-mono text-xs break-all text-fg-soft">
              {user.id}
            </dd>
            <dt className="font-mono text-muted">subject</dt>
            <dd className="font-mono text-xs break-all text-fg-soft">
              {user.subject}
            </dd>
            <dt className="font-mono text-muted">username</dt>
            <dd className="text-fg-soft">{user.username ?? "—"}</dd>
            <dt className="font-mono text-muted">registered</dt>
            <dd className="text-fg-soft">{formatDateTime(user.createdAt)}</dd>
            <dt className="font-mono text-muted">last login</dt>
            <dd className="text-fg-soft">{formatDateTime(user.lastLoginAt)}</dd>
            {user.deletedAt !== null && (
              <>
                <dt className="font-mono text-muted">deleted</dt>
                <dd className="text-fg-soft">
                  {formatDateTime(user.deletedAt)}
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Roles
          user={user}
          canManage={isSuperAdmin && user.deletedAt === null}
        />
        {user.deletedAt === null && <RestrictionCard user={user} />}
        <History user={user} />
      </div>
    </>
  );
}

function Roles({
  user,
  canManage,
}: {
  readonly user: AdminUserDetails;
  readonly canManage: boolean;
}) {
  const revoke = useAction(revokeRole, { errors: messages });
  const onRevoke = (role: Role) =>
    revoke.run(
      { params: { userId: user.id, role }, ...changed },
      { success: `Revoked ${role}.` },
    );
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <ShieldCheck size={16} className="text-accent" /> Roles
      </h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {user.roles.length === 0 && (
          <li className="text-sm text-muted">none</li>
        )}
        {user.roles.map((role) => (
          <li key={role}>
            <Badge
              tone={role === "normalUser" ? "neutral" : "accent"}
              className="pr-1"
            >
              {role}
              {canManage && (
                <button
                  type="button"
                  aria-label={`Revoke ${role}`}
                  className="ml-1 rounded p-0.5 hover:bg-danger-soft hover:text-danger"
                  onClick={() => onRevoke(role)}
                >
                  <X size={12} />
                </button>
              )}
            </Badge>
          </li>
        ))}
      </ul>
      {canManage ? (
        <GrantRoleForm user={user} />
      ) : (
        <p className="mt-4 text-xs text-muted">
          Only superAdmins grant and revoke roles.
        </p>
      )}
    </Card>
  );
}

const decodeBlogSlug = Schema.decodeUnknownOption(BlogSlug);

function GrantRoleForm({ user }: { readonly user: AdminUserDetails }) {
  const grant = useAction(grantRole, { errors: messages });
  const [kind, setKind] = useState<
    "admin" | "superAdmin" | "normalUser" | "blogEditor"
  >("blogEditor");
  const [blog, setBlog] = useState("");
  const slug = decodeBlogSlug(blog.trim());
  const role: Role | undefined =
    kind === "blogEditor"
      ? Option.isSome(slug)
        ? blogEditorRole(slug.value)
        : undefined
      : kind;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (role === undefined) return;
    const error = await grant.run(
      { params: { userId: user.id, role }, ...changed },
      { success: `Granted ${role}.` },
    );
    if (error === undefined) setBlog("");
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end"
    >
      <Field label="Grant role" className="sm:w-40">
        {(control) => (
          <Select
            {...control}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="blogEditor">blogEditor:</option>
            <option value="admin">admin</option>
            <option value="superAdmin">superAdmin</option>
            <option value="normalUser">normalUser</option>
          </Select>
        )}
      </Field>
      {kind === "blogEditor" && (
        <Field label="Blog slug" className="flex-1">
          {(control) => (
            <Input
              {...control}
              placeholder="rust-notes"
              list="blog-slugs"
              value={blog}
              onChange={(e) => setBlog(e.target.value)}
            />
          )}
        </Field>
      )}
      <BlogSlugOptions />
      <Button
        type="submit"
        variant="secondary"
        disabled={role === undefined}
        loading={grant.pending}
        icon={<Plus size={15} />}
      >
        Grant
      </Button>
    </form>
  );
}

/** The existing subblogs, offered as slugs for `blogEditor:`. */
function BlogSlugOptions() {
  const blogs = useAtomValue(blogsAtom);
  return (
    <datalist id="blog-slugs">
      {AsyncResult.isSuccess(blogs) &&
        blogs.value.map((blog) => (
          <option key={blog.slug} value={blog.slug}>
            {blog.title}
          </option>
        ))}
    </datalist>
  );
}

function RestrictionCard({ user }: { readonly user: AdminUserDetails }) {
  const restrict = useAction(restrictUser, {
    success: "Account restricted.",
    errors: messages,
  });
  const lift = useAction(liftRestriction, {
    success: "Restriction lifted.",
    errors: messages,
  });
  const [note, setNote] = useState("");
  const active = user.restriction;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = note.trim();
    const error =
      active === null
        ? await restrict.run({
            params: { userId: user.id },
            payload: { note: trimmed },
            ...changed,
          })
        : await lift.run({
            params: { userId: user.id },
            payload: trimmed === "" ? {} : { note: trimmed },
            ...changed,
          });
    if (error === undefined) setNote("");
  };

  return (
    <Card className={active === null ? "p-5" : "border-danger/40 p-5"}>
      <h2 className="flex items-center gap-2 font-semibold text-fg">
        <Ban
          size={16}
          className={active === null ? "text-muted" : "text-danger"}
        />
        {active === null ? "Restrict account" : "Restricted"}
      </h2>
      {active !== null && (
        <p className="mt-3 text-sm text-fg-soft">
          Since {formatDateTime(active.restrictedAt)}: “{active.note}”
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <Field
          label={active === null ? "Reason (required)" : "Note (optional)"}
          hint="Only admins see this note."
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              required={active === null}
              maxLength={RestrictionNoteMaxLength}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant={active === null ? "danger" : "secondary"}
          loading={restrict.pending || lift.pending}
        >
          {active === null
            ? "Restrict and log out everywhere"
            : "Lift restriction"}
        </Button>
      </form>
    </Card>
  );
}

function History({ user }: { readonly user: AdminUserDetails }) {
  const entries = [
    ...user.roleChanges.map((change) => ({
      at: change.changedAt,
      text: `${change.change === "granted" ? "granted" : "revoked"} ${change.role}`,
      by: change.changedBy,
    })),
    ...user.restrictions.flatMap((r) => [
      { at: r.restrictedAt, text: `restricted: ${r.note}`, by: r.restrictedBy },
      ...(r.liftedAt === null
        ? []
        : [
            {
              at: r.liftedAt,
              text: `lifted${r.liftNote === null ? "" : `: ${r.liftNote}`}`,
              by: r.liftedBy,
            },
          ]),
    ]),
  ].sort((a, b) => b.at.epochMilliseconds - a.at.epochMilliseconds);

  return (
    <Card className="p-5 xl:col-span-2">
      <h2 className="font-semibold text-fg">History</h2>
      <ol className="mt-4 space-y-2 font-mono text-xs">
        {entries.map((entry, index) => (
          <li key={index} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <span className="shrink-0 text-muted">
              {formatDateTime(entry.at)}
            </span>
            <span className="text-fg-soft">{entry.text}</span>
            <span className="text-muted">
              {entry.by === null ? (
                "by the system"
              ) : (
                <Link
                  className="hover:text-fg"
                  to={`../${entry.by}`}
                  relative="path"
                >
                  by {entry.by.slice(0, 8)}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
