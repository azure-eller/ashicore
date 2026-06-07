import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-(--space-16) w-full rounded-md border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-5) py-(--space-4) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none placeholder:text-[var(--color-ink-faint)] hover:border-[var(--color-ink-soft)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--color-surface-sunk)] disabled:text-[var(--color-ink-soft)] disabled:opacity-100 aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
