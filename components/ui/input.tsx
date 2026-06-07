import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      suppressHydrationWarning
      className={cn(
        "h-(--height-input-md) w-full min-w-0 rounded-md border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-5) py-(--space-2) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none file:inline-flex file:h-(--height-input-sm) file:border-0 file:bg-transparent file:text-[length:var(--text-sm)] file:font-medium file:text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] hover:border-[var(--color-ink-soft)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--color-surface-sunk)] disabled:text-[var(--color-ink-soft)] disabled:opacity-100 aria-invalid:border-[var(--color-danger)] aria-invalid:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
