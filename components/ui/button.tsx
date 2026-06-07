import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-all duration-(--duration-1) ease-(--ease-out) outline-none select-none focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-[var(--color-accent-text)] shadow-[var(--shadow-sm)] hover:brightness-[0.97] hover:-translate-y-px disabled:opacity-50",
        primary: "bg-[var(--color-accent)] text-[var(--color-accent-text)] shadow-[var(--shadow-sm)] hover:brightness-[0.97] hover:-translate-y-px disabled:opacity-50",
        outline:
          "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)] aria-expanded:bg-[var(--color-surface-alt)] aria-expanded:text-[var(--color-ink)] disabled:opacity-50",
        secondary:
          "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)] aria-expanded:bg-[var(--color-surface-alt)] aria-expanded:text-[var(--color-ink)] disabled:opacity-50",
        "secondary-muted":
          "border-[var(--color-line)] bg-[var(--color-surface-alt)] text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunk)] hover:text-[var(--color-ink)] aria-expanded:bg-[var(--color-surface-sunk)] disabled:opacity-50",
        ghost:
          "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-alt)] aria-expanded:bg-[var(--color-surface-alt)] aria-expanded:text-[var(--color-ink)] disabled:opacity-50",
        destructive:
          "bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger-soft),black_4%)] disabled:opacity-50",
        danger:
          "bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger-soft),black_4%)] disabled:opacity-50",
        link: "text-[var(--color-accent-ink)] underline-offset-4 hover:underline disabled:opacity-50",
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
