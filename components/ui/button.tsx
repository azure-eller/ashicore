import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-(--radius-none) border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-colors duration-(--duration-1) ease-(--ease-out) outline-none select-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-[var(--focus-ring)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]",
        primary: "bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]",
        outline:
          "border-border bg-[var(--color-surface)] text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "border-border bg-[var(--color-surface)] text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        "secondary-muted":
          "border-border bg-muted text-muted-foreground hover:bg-[var(--color-surface-sunk)] hover:text-foreground aria-expanded:bg-[var(--color-surface-sunk)]",
        ghost:
          "bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-primary-foreground hover:bg-destructive/90",
        danger: "bg-destructive text-primary-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-(--height-input-md) gap-(--space-3) px-(--space-6) text-[length:var(--text-sm)] leading-[var(--leading-sm)] has-data-[icon=inline-end]:pr-(--space-5) has-data-[icon=inline-start]:pl-(--space-5) [&_svg:not([class*='size-'])]:size-(--space-7)",
        xs: "h-(--height-input-sm) gap-(--space-3) px-(--space-4) text-[length:var(--text-xs)] leading-[var(--leading-xs)] has-data-[icon=inline-end]:pr-(--space-3) has-data-[icon=inline-start]:pl-(--space-3) [&_svg:not([class*='size-'])]:size-(--space-6)",
        sm: "h-(--height-input-sm) gap-(--space-3) px-(--space-5) text-[length:var(--text-xs)] leading-[var(--leading-xs)] has-data-[icon=inline-end]:pr-(--space-4) has-data-[icon=inline-start]:pl-(--space-4) [&_svg:not([class*='size-'])]:size-(--space-6)",
        lg: "h-(--height-input-lg) gap-(--space-3) px-(--space-7) text-[length:var(--text-base)] leading-[var(--leading-base)] has-data-[icon=inline-end]:pr-(--space-6) has-data-[icon=inline-start]:pl-(--space-6) [&_svg:not([class*='size-'])]:size-(--space-7)",
        icon: "size-(--height-input-md) [&_svg:not([class*='size-'])]:size-(--space-7)",
        "icon-xs":
          "size-(--height-input-sm) [&_svg:not([class*='size-'])]:size-(--space-6)",
        "icon-sm":
          "size-(--height-input-sm) [&_svg:not([class*='size-'])]:size-(--space-7)",
        "icon-lg": "size-(--height-input-lg) [&_svg:not([class*='size-'])]:size-(--space-8)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
