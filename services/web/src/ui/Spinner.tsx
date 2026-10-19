import { cn } from "#lib/cn.ts";

export function Spinner({
  size = 18,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("animate-spin", className)}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A centered spinner with a terminal-style caption, for loading pages. */
export function Loading({ label = "loading" }: { readonly label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 py-16 font-mono text-sm text-muted"
    >
      <Spinner className="text-accent" />
      <span>
        {label}
        <span className="animate-blink">_</span>
      </span>
    </div>
  );
}
