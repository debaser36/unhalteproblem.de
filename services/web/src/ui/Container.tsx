import type { ComponentProps } from "react";
import { cn } from "#lib/cn.ts";

export type ContainerWidth = "prose" | "default" | "wide";

const widths: Record<ContainerWidth, string> = {
  prose: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
};

export interface ContainerProps extends ComponentProps<"div"> {
  readonly width?: ContainerWidth;
}

export function Container({
  width = "default",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6", widths[width], className)}
      {...props}
    />
  );
}
