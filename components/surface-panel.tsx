import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfacePanelTone = "card" | "background";
type SurfacePanelPadding = "sm" | "md";

const toneClass: Record<SurfacePanelTone, string> = {
  background: "bg-background text-foreground",
  card: "bg-card text-card-foreground",
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
        "border",
        toneClass[tone],
        paddingClass[padding],
        interactive && "transition-colors hover:bg-muted focus-visible:bg-muted",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
