import type { ComponentProps, CSSProperties, ReactNode } from "react";

import { FieldGroup } from "@/components/ui/field";
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
  return (
    <div className={cn("overflow-x-auto rounded-lg border", className)}>
      <FieldGroup
        role="table"
        className="min-w-(--editable-line-grid-min-width) gap-0"
        style={
          {
            "--editable-line-grid-columns": columns,
            "--editable-line-grid-min-width": minWidth,
          } as CSSProperties
        }
      >
        <div
          role="row"
          className={cn(
            "grid grid-cols-(--editable-line-grid-columns) border-b bg-muted/50",
            headerClassName
          )}
        >
          {headers.map((header, index) => (
            <div
              key={index}
              role="columnheader"
              className="px-[var(--table-cell-px)] py-[var(--table-cell-py)] text-left align-middle text-sm font-medium whitespace-nowrap text-foreground"
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
        "grid grid-cols-(--editable-line-grid-columns) border-b transition-colors last:border-b-0 hover:bg-muted/50",
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
        "min-w-0 px-[var(--table-cell-px)] py-[var(--table-cell-py)] align-middle",
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

export {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridFullWidth,
  EditableLineGridRow,
};
