import type { ReactNode } from "react";
import { SurfacePanel } from "@/components/surface-panel";
import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  density = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  density?: "default" | "compact";
  className?: string;
}) {
  return (
    <SurfacePanel
      tone="background"
      padding="sm"
      className={cn(
        density === "compact" ? "p-(--space-2)" : "p-(--space-3)",
        className
      )}
    >
      <div className="font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">{label}</div>
      <div className="text-[length:var(--text-lg)] font-semibold tabular-nums">
        {value}
      </div>
    </SurfacePanel>
  );
}
