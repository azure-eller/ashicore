"use client";

import type { Table } from "@tanstack/react-table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

type StatusOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type DataTableStatusFilterProps<TData, TValue extends string> = {
  table: Table<TData>;
  columnId?: string;
  options: readonly StatusOption<TValue>[];
  ariaLabel: string;
  showAll?: boolean;
  onFilterValueChange?: (value: TValue | "all") => void;
};

export function DataTableStatusFilter<TData, TValue extends string>({
  table,
  columnId = "status",
  options,
  ariaLabel,
  showAll = true,
  onFilterValueChange,
}: DataTableStatusFilterProps<TData, TValue>) {
  const column = table.getColumn(columnId);
  const selected = (column?.getFilterValue() as string[] | undefined) ?? [];
  const value = selected.length === 0 ? "all" : selected.length === 1 ? selected[0] : "";
  const statusCounts = column?.getFacetedUniqueValues();
  const allCount = statusCounts
    ? Array.from(statusCounts.values()).reduce((sum, count) => sum + count, 0)
    : table.getFilteredRowModel().rows.length;
  const itemClassName = "gap-1.5";

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (!column) return;
        if (!showAll && !nextValue) return;
        if (!nextValue) {
          column.setFilterValue(undefined);
          onFilterValueChange?.("all");
          return;
        }
        column.setFilterValue(nextValue === "all" ? undefined : [nextValue]);
        onFilterValueChange?.(nextValue as TValue | "all");
      }}
      aria-label={ariaLabel}
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      {showAll ? (
        <ToggleGroupItem
          value="all"
          aria-label="Show all statuses"
          className={itemClassName}
        >
          All
          <span className="text-muted-foreground">{allCount}</span>
        </ToggleGroupItem>
      ) : null}
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={`Show ${option.label} status`}
          className={itemClassName}
        >
          {option.label}
          <span className="text-muted-foreground">
            {statusCounts?.get(option.value) ?? 0}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
