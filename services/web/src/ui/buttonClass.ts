import { cn } from "#lib/cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium " +
  "whitespace-nowrap transition-[background,color,box-shadow,border-color] " +
  "duration-150 disabled:pointer-events-none disabled:opacity-50 select-none";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:shadow-glow hover:brightness-110 " +
    "active:brightness-95",
  secondary:
    "border border-border-strong bg-surface-2 text-fg hover:border-accent/60 " +
    "hover:bg-surface-3",
  ghost: "text-fg-soft hover:bg-surface-2 hover:text-fg",
  danger:
    "border border-danger/40 bg-danger-soft text-danger hover:bg-danger " +
    "hover:text-bg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  icon: "h-9 w-9",
};

/** The class names of a button, for elements that look like one. */
export const buttonClass = (
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
) => cn(base, variants[variant], sizes[size], className);
