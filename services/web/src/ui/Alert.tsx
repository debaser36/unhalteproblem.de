import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/cn.ts";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { className: string; icon: ReactNode }> = {
  info: {
    className: "border-accent-2/30 bg-accent-2-soft text-accent-2",
    icon: <Info size={16} />,
  },
  success: {
    className: "border-accent/30 bg-accent-soft text-accent",
    icon: <CheckCircle2 size={16} />,
  },
  warning: {
    className: "border-warning/30 bg-warning-soft text-warning",
    icon: <AlertTriangle size={16} />,
  },
  danger: {
    className: "border-danger/30 bg-danger-soft text-danger",
    icon: <XCircle size={16} />,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  readonly tone?: AlertTone;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const { className: toneClass, icon } = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border px-4 py-3 text-sm",
        toneClass,
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="space-y-1">
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children !== undefined && (
          <div className="text-fg-soft">{children}</div>
        )}
      </div>
    </div>
  );
}
