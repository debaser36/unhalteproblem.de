import { AuditAction, type AuditCursor, UserId } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { useState } from "react";
import { Link } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { formatDateTime } from "#lib/format.ts";
import { Badge, type BadgeTone } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Field, Input, Select } from "#ui/Field.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import { auditPageAtom } from "./insightsAtoms.ts";

const decodeUserId = Schema.decodeUnknownOption(UserId);

const tone = (action: AuditAction): BadgeTone =>
  action === "login" || action === "logout"
    ? "neutral"
    : action === "login_refused" ||
        action === "user_restricted" ||
        action === "account_deleted"
      ? "danger"
      : "info";

export function AuditLogPage() {
  const [action, setAction] = useState<AuditAction>();
  const [user, setUser] = useState("");
  const userId = Option.getOrUndefined(decodeUserId(user.trim()));
  const [cursors, setCursors] = useState<
    ReadonlyArray<AuditCursor | undefined>
  >([undefined]);
  const filterKey = `${action ?? ""}|${userId ?? ""}`;

  return (
    <>
      <AdminHeading title="Audit log">
        Who did what to whom: ids only, kept for a year. Newest first.
      </AdminHeading>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label="Action">
          {(control) => (
            <Select
              {...control}
              value={action ?? ""}
              onChange={(e) => {
                setCursors([undefined]);
                setAction(
                  e.target.value === ""
                    ? undefined
                    : (e.target.value as AuditAction),
                );
              }}
            >
              <option value="">all</option>
              {AuditAction.literals.map((literal) => (
                <option key={literal} value={literal}>
                  {literal}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="User id"
          error={
            user.trim() !== "" && userId === undefined
              ? "a user id (UUID)"
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              placeholder="as actor or target"
              value={user}
              onChange={(e) => {
                setCursors([undefined]);
                setUser(e.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Table key={filterKey}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>Target</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        {cursors.map((cursor, index) => (
          <AsyncView
            key={index}
            atom={auditPageAtom({ cursor, action, userId })}
            loading={
              <tbody>
                <tr>
                  <Td colSpan={5} className="text-muted">
                    loading…
                  </Td>
                </tr>
              </tbody>
            }
          >
            {(page) => (
              <tbody>
                {page.entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-surface-2/50">
                    <Td className="font-mono text-xs whitespace-nowrap">
                      {formatDateTime(entry.at)}
                    </Td>
                    <Td>
                      <Badge tone={tone(entry.action)}>{entry.action}</Badge>
                    </Td>
                    <Td>
                      <UserRef id={entry.actorId} />
                    </Td>
                    <Td>
                      <UserRef id={entry.targetId} />
                    </Td>
                    <Td className="font-mono text-xs">{entry.detail ?? ""}</Td>
                  </tr>
                ))}
                {index === cursors.length - 1 && page.nextCursor !== null && (
                  <tr>
                    <Td colSpan={5} className="text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          page.nextCursor !== null &&
                          setCursors((all) => [
                            ...all,
                            page.nextCursor ?? undefined,
                          ])
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
        ))}
      </Table>
    </>
  );
}

function UserRef({ id }: { readonly id: string | null }) {
  if (id === null) return <span className="text-xs text-muted">system</span>;
  return (
    <Link
      to={`/admin/users/${id}`}
      className="font-mono text-xs text-accent-2 hover:underline"
    >
      {id.slice(0, 8)}
    </Link>
  );
}
