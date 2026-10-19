import { type ComponentProps, useLayoutEffect, useRef } from "react";
import { cn } from "#lib/cn.ts";

/**
 * A borderless textarea that grows with its text, for editing headings and
 * paragraphs in place with the page's own typography.
 */
export function AutoTextarea({
  className,
  value,
  ...props
}: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn(
        "w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent outline-none placeholder:text-muted/60 hover:border-border focus:border-accent/50",
        className,
      )}
      {...props}
    />
  );
}
