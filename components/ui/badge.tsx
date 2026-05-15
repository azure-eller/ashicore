import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-(--space-10) w-fit shrink-0 items-center justify-center gap-(--space-2) overflow-hidden rounded-(--radius-none) border border-transparent px-(--space-3) text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] whitespace-nowrap uppercase transition-colors duration-(--duration-1) ease-(--ease-out) focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] has-data-[icon=inline-end]:pr-(--space-2) has-data-[icon=inline-start]:pl-(--space-2) aria-invalid:border-destructive aria-invalid:shadow-[var(--focus-ring)] [&>svg]:pointer-events-none [&>svg]:size-(--space-6)!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-[var(--color-accent-hover)]",
        secondary:
          "bg-[var(--color-surface-sunk)] text-muted-foreground [a]:hover:bg-muted",
        destructive:
          "bg-[var(--color-danger-soft)] text-destructive [a]:hover:bg-[var(--color-danger-soft)]",
        success:
          "bg-[var(--color-success-soft)] text-success [a]:hover:bg-[var(--color-success-soft)]",
        warning:
          "bg-[var(--color-warning-soft)] text-warning [a]:hover:bg-[var(--color-warning-soft)]",
        outline:
          "border-border bg-[var(--color-surface)] text-muted-foreground [a]:hover:bg-muted",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
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
