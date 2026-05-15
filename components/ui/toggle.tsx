"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-(--space-2) rounded-(--radius-none) text-[length:var(--text-sm)] font-medium whitespace-nowrap transition-colors duration-(--duration-1) ease-(--ease-out) outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-[var(--focus-ring)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--space-7)",
  {
    variants: {
      variant: {
        default: "bg-transparent aria-pressed:bg-muted data-[state=on]:bg-muted",
        outline:
          "border border-input bg-transparent aria-pressed:bg-muted data-[state=on]:bg-muted hover:bg-muted",
        segmented:
          "bg-transparent data-[state=on]:bg-background",
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
