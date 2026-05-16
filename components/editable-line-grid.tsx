"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type EditableLineGridProps = {
  columns: string;
  headers: ReactNode[];
  children: ReactNode;
  minWidth?: string;
  className?: string;
  headerClassName?: string;
};

function EditableLineGrid({
  columns,
  headers,
  children,
  minWidth = "56rem",
  className,
  headerClassName,
}: EditableLineGridProps) {
  const widthStyle = minWidth
    ? {
        "--editable-line-grid-columns": columns,
        "--editable-line-grid-min-width": minWidth,
        "--editable-line-grid-width":
          "max(100%, var(--editable-line-grid-min-width))",
      }
    : {
        "--editable-line-grid-columns": columns,
        "--editable-line-grid-width": "100%",
      };

  return (
    <div className={cn("w-full overflow-x-auto border bg-card", className)}>
      <FieldGroup
        role="table"
        className="w-(--editable-line-grid-width) gap-0"
        style={widthStyle as CSSProperties}
      >
        <div
          role="row"
          className={cn(
            "grid min-w-0 grid-cols-(--editable-line-grid-columns) border-b bg-muted",
            headerClassName
          )}
        >
          {headers.map((header, index) => (
            <div
              key={index}
              role="columnheader"
              className="min-w-0 truncate px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-left align-middle text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] whitespace-nowrap text-muted-foreground uppercase"
            >
              {header}
            </div>
          ))}
        </div>
        {children}
      </FieldGroup>
    </div>
  );
}

function EditableLineGridRow({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      role="row"
      className={cn(
        "group/line-grid-row grid min-w-0 grid-cols-(--editable-line-grid-columns) border-b transition-colors last:border-b-0 hover:bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function EditableLineGridCell({
  children,
  className,
  align = "left",
  ...props
}: {
  children: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
} & Omit<ComponentProps<"div">, "children">) {
  return (
    <div
      role="cell"
      className={cn(
        "flex min-w-0 items-center overflow-hidden px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-[length:var(--text-sm)] leading-[var(--leading-sm)] [&_[data-slot=field]]:min-w-0 [&_input]:min-w-0 [&_p]:max-w-full [&_p]:overflow-hidden",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function EditableLineGridFullWidth({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="cell" className={cn("col-span-full min-w-0", className)}>
      {children}
    </div>
  );
}

function EditableLineGridRemoveButton({
  label = "Delete row",
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "text-destructive opacity-0 transition-opacity hover:bg-[var(--color-danger-soft)] hover:text-destructive focus-visible:opacity-100 group-hover/line-grid-row:opacity-100 group-focus-within/line-grid-row:opacity-100",
            className
          )}
          aria-label={label}
          {...props}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Delete row.</TooltipContent>
    </Tooltip>
  );
}

export {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridFullWidth,
  EditableLineGridRemoveButton,
  EditableLineGridRow,
};
