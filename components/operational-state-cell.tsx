import { cn } from "@/lib/utils";

type OperationalStateTone =
  | "success"
  | "warning"
  | "destructive"
  | "secondary"
  | "muted";

const toneClassName: Record<OperationalStateTone, string> = {
  success: "border-success/20 bg-background text-success",
  warning: "border-warning/25 bg-background text-warning",
  destructive: "border-destructive/20 bg-background text-destructive",
  secondary: "border-border bg-background text-foreground",
  muted: "border-border bg-muted text-muted-foreground",
};

export type OperationalState = {
  label: string;
  tone: OperationalStateTone;
};

export function OperationalStateCell({
  state,
  className,
}: {
  state: OperationalState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-(--height-input-sm) w-full min-w-28 items-center justify-center rounded-(--radius-none) border px-(--space-4) text-center text-[length:var(--text-xs)] font-medium",
        toneClassName[state.tone],
        className
      )}
    >
      {state.label}
    </span>
  );
}
