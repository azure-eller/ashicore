"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { DateTimeText } from "@/components/date-time-text";
import { Checkbox } from "@/components/ui/checkbox";
import {
  STOCKTAKE_STATUS_COLUMN_TOOLTIP,
  STOCKTAKE_COUNTED_TOOLTIP,
  STOCKTAKE_ITEM_COUNT_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  STOCKTAKE_VARIANCE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { StocktakeStatusBadge } from "./status-badge";
import { formatScope, type StocktakeListRow } from "./types";

const columns: ColumnDef<StocktakeListRow>[] = [
  {
    id: "select",
    header: ({ table }) => {
      const canSelectAny = table
        .getPaginationRowModel()
        .flatRows.some((row) => row.getCanSelect());

      return (
        <Checkbox
          checked={
            canSelectAny &&
            (table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate"))
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all draft stocktakes"
          disabled={!canSelectAny}
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.name}`}
        disabled={!row.getCanSelect()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    cell: ({ row }) => (
      <Link href={`/inventory/stocktakes/${row.original.id}`} className="hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "scope",
    header: ({ column }) => (
      <SortableHeader column={column} label="Scope" tooltip={STOCKTAKE_SCOPE_TOOLTIP} />
    ),
    cell: ({ row }) => formatScope(row.original.scope),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <FilterableHeader
        column={column}
        label="Status"
        tooltip={STOCKTAKE_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <StocktakeStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "itemCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Items" tooltip={STOCKTAKE_ITEM_COUNT_TOOLTIP} />
    ),
  },
  {
    accessorKey: "countedCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Counted" tooltip={STOCKTAKE_COUNTED_TOOLTIP} />
    ),
    cell: ({ row }) =>
      `${row.original.countedCount} / ${row.original.itemCount}`,
  },
  {
    accessorKey: "varianceCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Variance" tooltip={STOCKTAKE_VARIANCE_TOOLTIP} />
    ),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <SortableHeader column={column} label="Created" />,
    cell: ({ row }) => <DateTimeText value={row.original.createdAt} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => <DateTimeText value={row.original.completedAt} />,
  },
];

export function StocktakesTable({ initialData }: { initialData: StocktakeListRow[] }) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["stocktakes"]}
      queryFn={async () => {
        const response = await fetch("/api/stocktakes");
        if (!response.ok) {
          throw new Error("Failed to fetch stocktakes");
        }

        return response.json();
      }}
      enableRowSelection={(row) => row.original.status === "draft"}
      searchAriaLabel="Search stocktakes"
      addHref="/inventory/stocktakes/new"
      addAriaLabel="New Stocktake"
      emptyMessage="No stocktakes yet."
      deleteAction={{
        endpoint: "/api/stocktakes",
        invalidateQueryKeys: [["stocktakes"]],
        defaultErrorMessage: "Failed to delete stocktakes.",
        confirmTitle: (count) =>
          `Delete ${count} stocktake${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected draft stocktake${count !== 1 ? "s" : ""} will be cancelled. Only draft stocktakes can be deleted.`,
      }}
    />
  );
}
