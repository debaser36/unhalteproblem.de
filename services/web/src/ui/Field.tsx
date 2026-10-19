import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "#lib/cn.ts";

const control =
  "w-full rounded-lg border border-border-strong bg-surface-2 px-3 text-sm " +
  "text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "aria-[invalid=true]:border-danger disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(control, "min-h-28 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-10 pr-8", className)} {...props} />;
}

export interface FieldProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly className?: string;
  /** Renders the control, wired to the label, hint and error. */
  readonly children: (control: {
    readonly id: string;
    readonly "aria-describedby": string | undefined;
    readonly "aria-invalid": boolean;
  }) => ReactNode;
}

/** A labelled form control with an optional hint and error message. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? null : hintId, error ? errorId : null]
      .filter((x) => x !== null)
      .join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={id}
        className="block font-mono text-xs tracking-wide text-muted uppercase"
      >
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
      })}
      {hint !== undefined && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
