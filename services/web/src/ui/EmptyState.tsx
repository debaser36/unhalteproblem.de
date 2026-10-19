import type { ReactNode } from "react";

/** What a list shows when it has nothing to show. */
export function EmptyState({
  title,
  children,
  action,
}: {
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="font-mono text-sm text-accent">$ ls</p>
      <p className="mt-2 font-display text-lg text-fg">{title}</p>
      {children !== undefined && (
        <div className="mx-auto mt-2 max-w-md text-sm text-muted">
          {children}
        </div>
      )}
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  );
}
