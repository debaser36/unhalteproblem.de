import { cn } from "#lib/cn.ts";

export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-3", className)}
    />
  );
}
