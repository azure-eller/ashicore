import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type InsetPanelTone = "muted" | "subtle";
type InsetPanelPadding = "sm" | "md" | "lg" | "xl";

const toneClass: Record<InsetPanelTone, string> = {
  muted: "bg-[var(--color-surface-sunk)]",
  subtle: "bg-[var(--color-surface-alt)]",
};

const paddingClass: Record<InsetPanelPadding, string> = {
  sm: "p-(--space-6)",
  md: "p-(--space-5)",
  lg: "p-(--space-6)",
  xl: "p-(--space-16)",
};

type InsetPanelProps<TAs extends ElementType> = {
  as?: TAs;
  children: ReactNode;
  tone?: InsetPanelTone;
  padding?: InsetPanelPadding;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function InsetPanel<TAs extends ElementType = "div">({
  as,
  children,
  tone = "subtle",
  padding = "sm",
  className,
  ...props
}: InsetPanelProps<TAs>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-line)]",
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
