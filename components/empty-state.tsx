import type { ElementType, ReactNode } from "react";
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

  return (
    <Component
      className={cn(
        "border border-dashed border-border text-center text-[length:var(--text-sm)]",
        density === "compact" ? "p-(--space-8)" : "p-(--space-10)",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </Component>
  );
}
