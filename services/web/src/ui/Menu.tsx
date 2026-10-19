import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { cn } from "#lib/cn.ts";

/**
 * A dropdown menu: a trigger and a panel that closes on Escape, on a click
 * outside and after choosing an item.
 */
export function Menu({
  trigger,
  children,
  align = "end",
  label,
}: {
  /** The trigger's content; it is rendered inside a button. */
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly align?: "start" | "end";
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          // Closed after the click is handled: removing the panel at once
          // would cancel the submit of a form inside it (log out).
          onClick={() => setTimeout(close)}
          className={cn(
            "animate-fade-up absolute top-full z-50 mt-2 min-w-52 overflow-hidden rounded-xl border border-border-strong bg-surface p-1.5 shadow-2xl",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm " +
  "text-fg-soft transition-colors hover:bg-surface-2 hover:text-fg";

export function MenuLink({
  to,
  icon,
  children,
}: {
  readonly to: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Link role="menuitem" to={to} className={itemClass}>
      {icon}
      {children}
    </Link>
  );
}

export function MenuButton({
  icon,
  children,
  type = "button",
  onClick,
}: {
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
}) {
  return (
    <button role="menuitem" type={type} onClick={onClick} className={itemClass}>
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-border" />;
}
