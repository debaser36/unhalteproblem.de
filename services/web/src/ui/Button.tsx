import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "#lib/cn.ts";
import { Spinner } from "./Spinner.tsx";

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

export interface ButtonProps extends ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  readonly loading?: boolean;
  readonly icon?: ReactNode;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
}

/** A router link that looks like a button. */
export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}

export interface ExternalButtonLinkProps extends ComponentProps<"a"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
}

/** A link to another site that looks like a button; opens in a new tab. */
export function ExternalButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...props
}: ExternalButtonLinkProps) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {icon}
      {children}
    </a>
  );
}
