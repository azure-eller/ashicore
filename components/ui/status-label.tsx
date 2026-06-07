import * as React from "react"

import { cn } from "@/lib/utils"

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

const toneClasses: Record<StatusTone, string> = {
  success: "bg-[var(--color-success-soft)] text-[var(--status-success-ink)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--status-warning-ink)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--status-danger-ink)]",
  info: "bg-[var(--color-info-soft)] text-[color-mix(in_oklch,var(--color-info),var(--color-ink)_38%)]",
  neutral: "bg-[var(--color-surface-sunk)] text-[var(--color-ink-faint)]",
}

function StatusLabel({
  tone = "neutral",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: StatusTone
}) {
  return (
    <span
      data-slot="status-label"
      data-tone={tone}
      className={cn(
        "inline-flex h-(--space-10) w-fit shrink-0 items-center justify-center rounded-[var(--radius-pill)] border border-transparent px-(--space-3) font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] whitespace-nowrap uppercase transition-colors duration-(--duration-1) ease-(--ease-out) focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export { StatusLabel, type StatusTone }
