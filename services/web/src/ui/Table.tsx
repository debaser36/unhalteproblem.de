import type { ComponentProps } from "react";
import { cn } from "#lib/cn.ts";

/** A data table that scrolls sideways on narrow screens instead of breaking the layout. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface/80">
      <table
        className={cn("w-full min-w-[40rem] text-left text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border bg-surface-2/70 px-4 py-2.5 font-mono text-xs font-normal tracking-wide text-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "border-b border-border/60 px-4 py-3 align-top text-fg-soft",
        className,
      )}
      {...props}
    />
  );
}
