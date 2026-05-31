import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DashboardModuleShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-(--space-8) px-(--space-8) py-(--space-8) md:px-(--space-12) md:py-(--space-10)",
        className
      )}
    >
      {children}
    </div>
  );
}
