import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelTone = "muted" | "subtle" | "warning" | "destructive";
type PanelPadding = "sm" | "md" | "lg" | "xl";

const toneClass: Record<PanelTone, string> = {
  muted: "border-[var(--color-line)] bg-[var(--color-surface-sunk)]",
  subtle: "border-[var(--color-line)] bg-[var(--color-surface-alt)]",
  warning: "border-[var(--color-warning)] bg-[var(--color-warning-soft)]",
  destructive: "border-[var(--color-danger)] bg-[var(--color-danger-soft)]",
};

const paddingClass: Record<PanelPadding, string> = {
  sm: "p-(--space-5)",
  md: "p-(--space-6)",
  lg: "p-(--space-8)",
  xl: "p-(--space-16)",
};

type PanelProps<TAs extends ElementType> = {
  as?: TAs;
  children: ReactNode;
  tone?: PanelTone;
  padding?: PanelPadding;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function Panel<TAs extends ElementType = "div">({
  as,
  children,
  tone = "subtle",
  padding = "md",
  className,
  ...props
}: PanelProps<TAs>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(
        "rounded-[var(--radius-md)] border",
        toneClass[tone],
        paddingClass[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
