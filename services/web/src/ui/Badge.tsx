import type { ComponentProps } from "react";
import { cn } from "#lib/cn.ts";

export type BadgeTone = "neutral" | "accent" | "info" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border-strong bg-surface-2 text-fg-soft",
  accent: "border-accent/30 bg-accent-soft text-accent",
  info: "border-accent-2/30 bg-accent-2-soft text-accent-2",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

export interface BadgeProps extends ComponentProps<"span"> {
  readonly tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 " +
          "font-mono text-xs leading-5",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
