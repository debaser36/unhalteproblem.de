import type { ReactNode } from "react";

export function AdminHeading({
  title,
  children,
  actions,
}: {
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {children !== undefined && (
          <p className="mt-1 text-sm text-muted">{children}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
