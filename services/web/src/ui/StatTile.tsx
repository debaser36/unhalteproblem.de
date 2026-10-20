import type { ReactNode } from "react";
import { Card } from "./Card.tsx";

/** A headline number with its label and an optional note below. */
export function StatTile({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="font-mono text-xs tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold text-fg tabular-nums">
        {value}
      </p>
      {note !== undefined && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}
