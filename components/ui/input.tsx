import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-(--height-input-md) w-full min-w-0 rounded-(--radius-none) border border-input bg-background px-(--space-5) py-(--space-2) text-[length:var(--text-sm)] leading-[var(--leading-sm)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none file:inline-flex file:h-(--height-input-sm) file:border-0 file:bg-transparent file:text-[length:var(--text-sm)] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-[var(--focus-ring)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
