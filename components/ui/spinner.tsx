import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

type SpinnerProps = SVGProps<SVGSVGElement>

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 50 50"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin text-[var(--color-accent-ink)] motion-reduce:animate-none", className)}
      {...props}
    >
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="var(--color-line)"
        strokeWidth="4"
      />
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="90 150"
        strokeDashoffset="-35"
      />
    </svg>
  )
}

export { Spinner }
