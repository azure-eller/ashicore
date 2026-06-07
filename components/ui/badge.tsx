import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-(--space-10) w-fit shrink-0 items-center justify-center gap-(--space-2) overflow-hidden rounded-full border border-transparent px-(--space-3) font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] whitespace-nowrap uppercase transition-colors duration-(--duration-1) ease-(--ease-out) focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] has-data-[icon=inline-end]:pr-(--space-2) has-data-[icon=inline-start]:pl-(--space-2) aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)] [&>svg]:pointer-events-none [&>svg]:size-(--space-6)!",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] [a]:hover:bg-[var(--color-accent-soft)]",
        secondary:
          "bg-[var(--color-surface-sunk)] text-[var(--color-ink-faint)] [a]:hover:bg-[var(--color-surface-alt)]",
        destructive:
          "bg-[var(--color-danger-soft)] text-[var(--status-danger-ink)] [a]:hover:bg-[var(--color-danger-soft)]",
        success:
          "bg-[var(--color-success-soft)] text-[var(--status-success-ink)] [a]:hover:bg-[var(--color-success-soft)]",
        warning:
          "bg-[var(--color-warning-soft)] text-[var(--status-warning-ink)] [a]:hover:bg-[var(--color-warning-soft)]",
        outline:
          "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)] [a]:hover:bg-[var(--color-surface-alt)]",
        ghost:
          "hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink-faint)]",
        link: "text-[var(--color-accent-ink)] underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
