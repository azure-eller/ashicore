"use client";

import type { Table } from "@tanstack/react-table";
import {
  SegmentedCountFilter,
  type SegmentedCountFilterOption,
} from "@/components/segmented-count-filter";

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
  const value = (
    selected.length === 0 ? "all" : selected.length === 1 ? selected[0] : ""
  ) as TValue | "all" | "";
  const statusCounts = column?.getFacetedUniqueValues();
  const allCount = statusCounts
    ? Array.from(statusCounts.values()).reduce((sum, count) => sum + count, 0)
    : table.getFilteredRowModel().rows.length;
  const filterOptions: SegmentedCountFilterOption<TValue | "all">[] = [
    ...(showAll
      ? [
          {
            value: "all" as const,
            label: "All",
            count: allCount,
            ariaLabel: "Show all statuses",
          },
        ]
      : []),
    ...options.map((option) => ({
      value: option.value,
      label: option.label,
      count: statusCounts?.get(option.value) ?? 0,
      ariaLabel: `Show ${option.label} status`,
    })),
  ];

  return (
    <SegmentedCountFilter
      value={value}
      options={filterOptions}
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
      ariaLabel={ariaLabel}
    />
  );
}
