import * as React from "react"

import { cn } from "@/lib/utils"

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

const toneClasses: Record<StatusTone, string> = {
  success: "text-[var(--color-success)] before:bg-[var(--color-success)]",
  warning: "text-[var(--color-warning)] before:bg-[var(--color-warning)]",
  danger: "text-[var(--color-danger)] before:bg-[var(--color-danger)]",
  info: "text-[var(--color-info)] before:bg-[var(--color-info)]",
  neutral: "text-muted-foreground before:bg-[var(--color-muted)]",
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
        "inline-flex items-center gap-(--space-3) text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-wide)] uppercase before:size-(--space-4) before:shrink-0 before:rounded-(--radius-none) before:content-['']",
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
