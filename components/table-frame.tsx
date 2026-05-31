import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto border border-border", className)}>
      {children}
    </div>
  );
}

type TableFrameEdgeProps = {
  children: ReactNode;
  className?: string;
};

export function TableFrameHeader({ children, className }: TableFrameEdgeProps) {
  return (
    <div className={cn("border-b bg-muted/20 px-(--space-8) py-(--space-4)", className)}>
      {children}
    </div>
  );
}

export function TableFrameFooter({ children, className }: TableFrameEdgeProps) {
  return (
    <div className={cn("border-t px-(--space-8) py-(--space-4)", className)}>
      {children}
    </div>
  );
}

export function FramedTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse text-[length:var(--text-sm)]", className)}>
      {children}
    </table>
  );
}

export function FramedTableHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead
      className={cn(
        "bg-[var(--color-surface-muted)] text-left text-[length:var(--text-xs)] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function FramedTableRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("border-b border-border last:border-b-0", className)}>
      {children}
    </tr>
  );
}

export function FramedTableHeaderCell({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "p-(--space-3) font-medium",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function FramedTableCell({
  children,
  align = "left",
  numeric = false,
  strong = false,
  muted = false,
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  strong?: boolean;
  muted?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "p-(--space-3)",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "font-mono tabular-nums",
        strong && "font-semibold",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {children}
    </td>
  );
}
