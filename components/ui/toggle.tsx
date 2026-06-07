"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-(--space-2) rounded-md text-[length:var(--text-sm)] font-medium whitespace-nowrap text-[var(--color-ink-soft)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--space-7)",
  {
    variants: {
      variant: {
        default:
          "bg-transparent aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-[var(--color-accent-ink)] data-[state=on]:bg-[var(--color-accent-soft)] data-[state=on]:text-[var(--color-accent-ink)]",
        outline:
          "border border-[var(--color-line)] bg-[var(--color-surface)] aria-pressed:border-[var(--color-accent)] aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-[var(--color-accent-ink)] data-[state=on]:border-[var(--color-accent)] data-[state=on]:bg-[var(--color-accent-soft)] data-[state=on]:text-[var(--color-accent-ink)] hover:bg-[var(--color-surface-alt)]",
        segmented:
          "bg-transparent data-[state=on]:bg-[var(--color-surface)] data-[state=on]:text-[var(--color-ink)] data-[state=on]:shadow-[var(--shadow-sticky)]",
      },
      size: {
        default: "h-(--height-input-md) min-w-(--height-input-md) px-(--space-4)",
        sm: "h-(--height-input-sm) min-w-(--height-input-sm) px-(--space-3) text-[length:var(--text-xs)]",
        lg: "h-(--height-input-lg) min-w-(--height-input-lg) px-(--space-5)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
