import type { AdminUser, UserCursor } from "@unhalteproblem.de/api";
import { useState } from "react";
import { Link } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { formatDate } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import { userPageAtom } from "./adminAtoms.ts";

export function UsersPage() {
  // One entry per loaded page: undefined is the first, then each
  // page's `nextCursor`.
  const [cursors, setCursors] = useState<ReadonlyArray<UserCursor | undefined>>(
    [undefined],
  );
  return (
    <>
      <AdminHeading title="Users">
        Everyone who has logged in at least once, oldest first.
      </AdminHeading>
      <Table>
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Roles</Th>
            <Th>Status</Th>
            <Th>Registered</Th>
            <Th>Last login</Th>
          </tr>
        </thead>
        {cursors.map((cursor, index) => (
          <UserRows
            key={index}
            cursor={cursor}
            isLast={index === cursors.length - 1}
            onMore={(next) => setCursors((all) => [...all, next])}
          />
        ))}
      </Table>
    </>
  );
}

function UserRows({
  cursor,
  isLast,
  onMore,
}: {
  readonly cursor: UserCursor | undefined;
  readonly isLast: boolean;
  readonly onMore: (next: UserCursor) => void;
}) {
  return (
    <AsyncView
      atom={userPageAtom(cursor)}
      loading={
        <tbody>
          <tr>
            <Td colSpan={5} className="text-center text-muted">
              loading…
            </Td>
          </tr>
        </tbody>
      }
      failure={() => (
        <tbody>
          <tr>
            <Td colSpan={5} className="text-danger">
              Could not load users.
            </Td>
          </tr>
        </tbody>
      )}
    >
      {(page) => (
        <tbody>
          {page.users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
          {isLast && page.nextCursor !== null && (
            <tr>
              <Td colSpan={5} className="text-center">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    page.nextCursor !== null && onMore(page.nextCursor)
                  }
                >
                  Load more
                </Button>
              </Td>
            </tr>
          )}
        </tbody>
      )}
    </AsyncView>
  );
}

function UserRow({ user }: { readonly user: AdminUser }) {
  const name =
    user.name ??
    user.username ??
    (user.deletedAt === null ? "unnamed" : "deleted account");
  return (
    <tr className="transition-colors hover:bg-surface-2/50">
      <Td>
        <Link to={user.id} className="font-medium text-fg hover:text-accent">
          {name}
        </Link>
        <p className="text-xs text-muted">{user.email ?? "—"}</p>
      </Td>
      <Td>
        <div className="flex flex-wrap gap-1">
          {user.roles
            .filter((role) => role !== "normalUser")
            .map((role) => (
              <Badge key={role} tone="accent">
                {role}
              </Badge>
            ))}
        </div>
      </Td>
      <Td>
        {user.deletedAt !== null ? (
          <Badge>deleted</Badge>
        ) : user.restriction !== null ? (
          <Badge tone="danger">restricted</Badge>
        ) : (
          <Badge tone="accent">active</Badge>
        )}
      </Td>
      <Td className="whitespace-nowrap">{formatDate(user.createdAt)}</Td>
      <Td className="whitespace-nowrap">{formatDate(user.lastLoginAt)}</Td>
    </tr>
  );
}
