import type { ComponentPropsWithoutRef, ReactNode } from "react";
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
  containerClassName,
  ...props
}: ComponentPropsWithoutRef<"table"> & {
  containerClassName?: string;
}) {
  const table = (
    <table
      className={cn(
        "w-full border-collapse text-[length:var(--text-md)] leading-[var(--leading-md)]",
        className,
      )}
      {...props}
    >
      {children}
    </table>
  );

  if (containerClassName) {
    return <div className={cn("relative w-full overflow-x-auto", containerClassName)}>{table}</div>;
  }

  return table;
}

export function FramedTableHead({
  children,
  className,
  sticky = false,
  ...props
}: ComponentPropsWithoutRef<"thead"> & {
  sticky?: boolean;
}) {
  return (
    <thead
      className={cn(
        "bg-[var(--color-surface-muted)] text-left text-[length:var(--text-sm)] leading-[var(--leading-sm)] font-medium text-muted-foreground",
        sticky && "sticky top-0 z-10",
        className,
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

export function FramedTableBody({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {children}
    </tbody>
  );
}

export function FramedTableRow({
  children,
  className,
  selected = false,
  ...props
}: ComponentPropsWithoutRef<"tr"> & {
  selected?: boolean;
}) {
  const dataState = selected
    ? "selected"
    : (props as { "data-state"?: string })["data-state"];

  return (
    <tr
      {...props}
      data-state={dataState}
      className={cn(
        "border-b border-border transition-colors hover:bg-muted data-[state=selected]:bg-[var(--color-accent-soft)]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function FramedTableHeaderCell({
  children,
  align = "left",
  className,
  ...props
}: ComponentPropsWithoutRef<"th"> & {
  children?: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "px-[var(--table-cell-px)] py-[var(--table-cell-py)] align-middle font-medium tracking-[var(--tracking-caps)] whitespace-nowrap uppercase",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
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
  ...props
}: ComponentPropsWithoutRef<"td"> & {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-[var(--table-cell-px)] py-[var(--table-cell-py)] align-middle whitespace-nowrap text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "font-mono tabular-nums",
        strong && "font-semibold",
        muted && "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

export function FramedTableEmptyRow({
  children,
  colSpan,
  className,
  height = "default",
}: {
  children: ReactNode;
  colSpan: number;
  className?: string;
  height?: "default" | "compact";
}) {
  return (
    <FramedTableRow>
      <FramedTableCell
        colSpan={colSpan}
        align="center"
        muted
        className={cn(
          height === "compact"
            ? "h-[calc(var(--space-20)+var(--space-8))]"
            : "h-[calc(var(--space-20)*2)]",
          className,
        )}
      >
        {children}
      </FramedTableCell>
    </FramedTableRow>
  );
}
