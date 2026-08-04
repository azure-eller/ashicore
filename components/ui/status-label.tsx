import * as React from "react"

import { cn } from "@/lib/utils"

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

// Same soft-tint chip palette as StatusBlock so every status pill in the app
// reads identically.
const toneClasses: Record<StatusTone, string> = {
  success: "bg-[var(--chip-success-bg)] text-[var(--chip-success-ink)]",
  warning: "bg-[var(--chip-warning-bg)] text-[var(--chip-warning-ink)]",
  danger: "bg-[var(--chip-danger-bg)] text-[var(--chip-danger-ink)]",
  info: "bg-[var(--chip-info-bg)] text-[var(--chip-info-ink)]",
  neutral: "bg-[var(--chip-muted-bg)] text-[var(--chip-muted-ink)]",
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
        "inline-flex h-(--height-chip) w-fit shrink-0 items-center justify-center rounded-(--radius-sm) border border-transparent px-(--space-4) font-sans text-[length:var(--text-status)] leading-none font-semibold tracking-[0.005em] whitespace-nowrap transition-colors duration-(--duration-1) ease-(--ease-out) focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]",
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
