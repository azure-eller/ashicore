import type { ReactNode } from "react";
import { SurfacePanel } from "@/components/surface-panel";
import { cn } from "@/lib/utils";

export function InventoryVisualPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SurfacePanel padding="sm" className={className}>
      {children}
    </SurfacePanel>
  );
}

export function InventoryVisualCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-background", className)}>
      {children}
    </div>
  );
}
