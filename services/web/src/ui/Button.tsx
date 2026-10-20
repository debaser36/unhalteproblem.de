import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import {
  type ButtonSize,
  type ButtonVariant,
  buttonClass,
} from "./buttonClass.ts";
import { Spinner } from "./Spinner.tsx";

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
