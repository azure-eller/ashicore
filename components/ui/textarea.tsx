import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-(--space-16) w-full rounded-(--radius-none) border border-input bg-background px-(--space-5) py-(--space-4) text-[length:var(--text-sm)] leading-[var(--leading-sm)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-[var(--focus-ring)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
