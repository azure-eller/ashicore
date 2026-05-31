import type { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type TableEmptyRowProps = {
  children: ReactNode;
  colSpan: number;
  className?: string;
  height?: "default" | "compact";
};

export function TableEmptyRow({
  children,
  colSpan,
  className,
  height = "default",
}: TableEmptyRowProps) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className={cn(
          "text-center text-muted-foreground",
          height === "compact"
            ? "h-[calc(var(--space-20)+var(--space-8))]"
            : "h-[calc(var(--space-20)*2)]",
          className,
        )}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}
