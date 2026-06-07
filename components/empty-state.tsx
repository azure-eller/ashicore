import type { ElementType, ReactNode } from "react";
import { Alert02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

type EmptyStateProps<TAs extends ElementType = "div"> = {
  as?: TAs;
  children: ReactNode;
  className?: string;
  density?: "default" | "compact";
  tone?: "muted" | "destructive";
};

export function EmptyState<TAs extends ElementType = "div">({
  as,
  children,
  className,
  density = "default",
  tone = "muted",
}: EmptyStateProps<TAs>) {
  const Component = as ?? "div";
  const icon = tone === "destructive" ? Alert02Icon : Search01Icon;

  return (
    <Component
      className={cn(
        "flex flex-col items-center justify-center gap-(--space-4) rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-center",
        density === "compact" ? "p-(--space-8)" : "p-(--space-12)",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-(--space-16) place-items-center rounded-md border shadow-[var(--shadow-sticky)]",
          tone === "destructive"
            ? "border-[color-mix(in_oklch,var(--color-danger),transparent_72%)] bg-[var(--color-danger-soft)] text-[var(--status-danger-ink)]"
            : "border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
        )}
        aria-hidden
      >
        <HugeiconsIcon icon={icon} size={18} strokeWidth={2} />
      </span>
      <span
        className={cn(
          "max-w-sm font-display text-[length:var(--text-sm)] font-medium leading-[var(--leading-sm)]",
          tone === "destructive"
            ? "text-[var(--status-danger-ink)]"
            : "text-[var(--color-ink-soft)]",
        )}
      >
        {children}
      </span>
    </Component>
  );
}
