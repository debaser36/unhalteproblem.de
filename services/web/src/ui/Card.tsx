import type { ComponentProps } from "react";
import { cn } from "#lib/cn.ts";

export interface CardProps extends ComponentProps<"div"> {
  /** Lifts the card and lights its border on hover (for clickable cards). */
  readonly interactive?: boolean;
}

export function Card({ interactive = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface/80 backdrop-blur-sm",
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 " +
            "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-glow",
        className,
      )}
      {...props}
    />
  );
}
