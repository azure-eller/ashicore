import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type NoticePanelTone = "warning" | "destructive";
type NoticePanelPadding = "sm" | "md" | "lg";

const toneClass: Record<NoticePanelTone, string> = {
  destructive: "border-destructive bg-[var(--color-danger-soft)]",
  warning: "border-warning bg-[var(--color-warning-soft)]",
};

const paddingClass: Record<NoticePanelPadding, string> = {
  sm: "p-(--space-6)",
  md: "p-(--space-5)",
  lg: "p-(--space-8)",
};

type NoticePanelProps<TAs extends ElementType> = {
  as?: TAs;
  children: ReactNode;
  tone?: NoticePanelTone;
  padding?: NoticePanelPadding;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function NoticePanel<TAs extends ElementType = "div">({
  as,
  children,
  tone = "warning",
  padding = "sm",
  className,
  ...props
}: NoticePanelProps<TAs>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn("border", toneClass[tone], paddingClass[padding], className)}
      {...props}
    >
      {children}
    </Component>
  );
}
