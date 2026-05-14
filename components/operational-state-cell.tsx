import { cn } from "@/lib/utils";

type OperationalStateTone =
  | "success"
  | "warning"
  | "destructive"
  | "secondary"
  | "muted";

const toneClassName: Record<OperationalStateTone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  secondary: "border-primary/15 bg-primary/10 text-primary",
  muted: "border-border bg-muted/60 text-muted-foreground",
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
        "inline-flex min-h-8 w-full min-w-28 items-center justify-center rounded-md border px-2 text-center text-sm font-medium",
        toneClassName[state.tone],
        className
      )}
    >
      {state.label}
    </span>
  );
}
