import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfacePanelTone = "card" | "background";
type SurfacePanelPadding = "sm" | "md";

const toneClass: Record<SurfacePanelTone, string> = {
  background: "bg-[var(--color-surface-alt)] text-[var(--color-ink)]",
  card: "bg-[var(--color-surface)] text-[var(--color-ink)]",
};

const paddingClass: Record<SurfacePanelPadding, string> = {
  sm: "p-(--space-6)",
  md: "p-(--space-8)",
};

type SurfacePanelProps<TAs extends ElementType> = {
  as?: TAs;
  children: ReactNode;
  tone?: SurfacePanelTone;
  padding?: SurfacePanelPadding;
  interactive?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function SurfacePanel<TAs extends ElementType = "div">({
  as,
  children,
  tone = "card",
  padding = "md",
  interactive = false,
  className,
  ...props
}: SurfacePanelProps<TAs>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(
        "min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] shadow-[var(--shadow-sm)]",
        toneClass[tone],
        paddingClass[padding],
        interactive && "outline-none transition-colors duration-(--duration-1) ease-(--ease-out) hover:bg-[var(--color-surface-alt)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
