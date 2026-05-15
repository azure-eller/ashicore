import * as React from "react"

import { cn } from "@/lib/utils"
import type { StatusTone } from "@/components/ui/status-label"

const toneVars: Record<StatusTone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-info)",
  neutral: "var(--color-muted)",
}

function StatusRibbon({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="status-ribbon"
      className={cn(
        "flex h-(--height-statusbar) items-center gap-(--space-10) border-b border-border bg-muted px-(--space-8) text-[length:var(--text-xs)] leading-[var(--leading-xs)] tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function StatusRibbonSpacer({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="status-ribbon-spacer"
      className={cn("min-w-(--space-8) flex-1", className)}
      {...props}
    />
  )
}

type StatusRibbonStatProps = Omit<
  React.ComponentProps<"button">,
  "value"
> & {
  tone?: StatusTone
  count?: React.ReactNode
  value?: React.ReactNode
  label: React.ReactNode
  active?: boolean
}

function StatusRibbonStat({
  tone,
  count,
  value,
  label,
  active = false,
  className,
  onClick,
  type = "button",
  style,
  ...props
}: StatusRibbonStatProps) {
  const clickable = typeof onClick === "function"
  const toneValue = tone ? toneVars[tone] : undefined
  const statValue = value ?? count
  const content = (
    <>
      {tone ? (
        <span
          aria-hidden="true"
          className="size-(--space-4) shrink-0 bg-[var(--status-ribbon-tone)]"
        />
      ) : null}
      {statValue != null ? (
        <span className="font-semibold text-foreground">{statValue}</span>
      ) : null}
      <span className="text-muted-foreground">{label}</span>
    </>
  )
  const statClassName = cn(
    "flex h-full items-center gap-(--space-3) px-(--space-2) text-left outline-none transition-colors duration-(--duration-1) ease-(--ease-out) data-[clickable=true]:hover:bg-[var(--color-surface-sunk)] data-[active=true]:shadow-[inset_0_-2px_0_var(--status-ribbon-tone)] focus-visible:shadow-[var(--focus-ring)]",
    className
  )
  const statStyle = {
    "--status-ribbon-tone": toneValue,
    ...style,
  } as React.CSSProperties

  if (clickable) {
    return (
      <button
        data-slot="status-ribbon-stat"
        data-clickable="true"
        data-active={active ? "true" : undefined}
        className={statClassName}
        onClick={onClick}
        style={statStyle}
        type={type}
        {...props}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      data-slot="status-ribbon-stat"
      data-active={active ? "true" : undefined}
      className={statClassName}
      style={statStyle}
    >
      {content}
    </div>
  )
}

StatusRibbon.Stat = StatusRibbonStat
StatusRibbon.Spacer = StatusRibbonSpacer

export { StatusRibbon, StatusRibbonSpacer, StatusRibbonStat }
