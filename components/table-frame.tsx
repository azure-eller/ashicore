import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export function TableFrame({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "card";
}) {
  return (
    <div
      data-slot="table-frame"
      data-variant={variant}
      className={cn(
        "overflow-x-auto rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface)]",
        variant === "card" ? "shadow-[var(--shadow-sm)]" : "shadow-none",
        className
      )}
    >
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
    <div className={cn("border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] px-(--space-8) py-(--space-4)", className)}>
      {children}
    </div>
  );
}

export function TableFrameFooter({ children, className }: TableFrameEdgeProps) {
  return (
    <div className={cn("border-t border-[var(--color-line-soft)] px-(--space-8) py-(--space-4)", className)}>
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
        "bg-[var(--color-surface-sunk)] text-left font-sans text-[length:var(--text-card-header)] leading-[var(--leading-xs)] font-bold tracking-[0.04em] text-[var(--color-ink-2)] uppercase",
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
    <tbody className={cn("[&_tr:last-child]:border-0 [&_tr:last-child_td]:border-b-0", className)} {...props}>
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
        "border-b border-[var(--color-line-soft)] transition-colors hover:bg-[var(--color-surface-alt)] data-[state=selected]:bg-[var(--color-accent-soft)]",
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
        "h-(--height-framed-table-header) border-r border-b border-[var(--color-line-soft)] px-(--space-7) py-[var(--table-cell-py)] align-middle font-bold tracking-[0.04em] whitespace-nowrap uppercase last:border-r-0",
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
        "h-(--height-framed-table-row) border-r border-b border-[var(--color-line-soft)] px-(--space-7) py-[var(--table-cell-py)] align-middle text-[length:var(--text-card-control)] whitespace-nowrap text-[var(--color-ink)] last:border-r-0",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "font-mono tabular-nums",
        strong && "font-semibold",
        muted && "text-[var(--color-ink-faint)]",
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
        className={cn(
          height === "compact"
            ? "h-[calc(var(--space-20)*2)]"
            : "h-[calc(var(--space-20)*3)]",
          className,
        )}
      >
        <span className="flex flex-col items-center justify-center gap-(--space-4)">
          <span className="grid size-(--space-16) place-items-center rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] shadow-[var(--shadow-sticky)]">
            <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} aria-hidden />
          </span>
          <span className="max-w-sm font-display text-[length:var(--text-sm)] font-medium leading-[var(--leading-sm)] text-[var(--color-ink-soft)]">
            {children}
          </span>
        </span>
      </FramedTableCell>
    </FramedTableRow>
  );
}
