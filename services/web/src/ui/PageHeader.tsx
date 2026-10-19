import type { ReactNode } from "react";

/**
 * The heading of a page, introduced by a shell prompt (`~/blog $`) that
 * says where on the site the reader is.
 */
export function PageHeader({
  path,
  title,
  children,
  actions,
}: {
  /** The prompt's working directory, e.g. `~/blog`. */
  readonly path: string;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="animate-fade-up space-y-4 pt-10 pb-8 sm:pt-16">
      <p className="font-mono text-sm text-muted">
        <span className="text-accent">nico@unhalteproblem</span>
        <span>:</span>
        <span className="text-accent-2">{path}</span>
        <span> $</span>
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-4xl font-semibold text-fg sm:text-5xl">{title}</h1>
        {actions !== undefined && (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        )}
      </div>
      {children !== undefined && (
        <div className="max-w-2xl text-lg text-fg-soft">{children}</div>
      )}
    </header>
  );
}
