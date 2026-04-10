"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { SortableHeader } from "@/components/sortable-header";
import { formatDate } from "@/lib/format";
import type { PricingScheduleRow } from "./types";

const columns: ColumnDef<PricingScheduleRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all pricing schedules"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.name}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} label="Schedule" />,
    cell: ({ row }) => (
      <Link
        href={`/sales/pricing/schedules/${row.original.id}/edit`}
        className="hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "customerScopeLabel",
    header: ({ column }) => <SortableHeader column={column} label="Scope" />,
  },
  {
    accessorKey: "unitLabel",
    header: ({ column }) => <SortableHeader column={column} label="Unit" />,
  },
  {
    accessorKey: "breakSummary",
    header: "Breaks",
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => <SortableHeader column={column} label="Updated" />,
    sortingFn: (a, b) =>
      new Date(a.original.updatedAt).getTime() -
      new Date(b.original.updatedAt).getTime(),
    cell: ({ row }) => formatDate(row.original.updatedAt),
  },
];

export function PricingSchedulesTable({
  initialData,
}: {
  initialData: PricingScheduleRow[];
}) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["pricing-schedules"]}
      queryFn={async () => {
        const response = await fetch("/api/pricing-schedules");
        if (!response.ok) {
          throw new Error("Failed to fetch pricing schedules");
        }

        return response.json();
      }}
      searchAriaLabel="Search pricing schedules"
      addHref="/sales/pricing/schedules/new"
      addAriaLabel="New Pricing Schedule"
      emptyMessage="No pricing schedules yet."
      deleteAction={{
        endpoint: "/api/pricing-schedules",
        invalidateQueryKeys: [["pricing-schedules"]],
        defaultErrorMessage: "Failed to delete pricing schedules.",
        confirmTitle: (count) =>
          `Delete ${count} pricing schedule${count !== 1 ? "s" : ""}?`,
        confirmDescription: () =>
          "The selected pricing schedules will be soft-deleted.",
      }}
    />
  );
}
