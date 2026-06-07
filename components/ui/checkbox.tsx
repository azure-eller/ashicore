"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-(--space-8) shrink-0 items-center justify-center rounded-sm border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-(--space-6) after:-inset-y-(--space-4) hover:border-[var(--color-ink-soft)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)] aria-invalid:aria-checked:border-[var(--color-accent)] data-checked:border-[var(--color-accent)] data-checked:bg-[var(--color-accent)] data-checked:text-[var(--color-accent-text)]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-(--space-7)"
      >
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
