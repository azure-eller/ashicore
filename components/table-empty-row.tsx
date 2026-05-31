import type { ReactNode } from "react";
import { FramedTableEmptyRow } from "@/components/table-frame";

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
    <FramedTableEmptyRow colSpan={colSpan} className={className} height={height}>
      {children}
    </FramedTableEmptyRow>
  );
}
