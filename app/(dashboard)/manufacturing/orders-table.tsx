"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type { ManufacturingOrderListRow } from "./types";

const columns: ColumnDef<ManufacturingOrderListRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all manufacturing orders"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.orderNumber}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "orderNumber",
    header: ({ column }) => <SortableHeader column={column} label="Order" />,
    cell: ({ row }) => (
      <Link
        href={`/manufacturing/orders/${row.original.id}`}
        className="hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "productName",
    header: ({ column }) => <SortableHeader column={column} label="Product" />,
    cell: ({ row }) =>
      row.original.productSku
        ? `${row.original.productName} (${row.original.productSku})`
        : row.original.productName,
  },
  {
    accessorKey: "salesOrderNumber",
    header: "Sales Order",
    cell: ({ row }) => row.original.salesOrderNumber ?? "\u2014",
  },
  {
    accessorKey: "plannedQuantity",
    header: ({ column }) => <SortableHeader column={column} label="Planned" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.plannedQuantity) - parseFloat(b.original.plannedQuantity),
    cell: ({ row }) => {
      const qty = `${row.original.plannedQuantity} ${row.original.unitName}`;
      if (row.original.manufacturingMode === "batch" && row.original.numberOfBatches != null) {
        return `${qty} (${row.original.numberOfBatches}b)`;
      }
      return qty;
    },
  },
  {
    accessorKey: "actualQuantity",
    header: "Actual",
    cell: ({ row }) =>
      row.original.actualQuantity != null
        ? `${row.original.actualQuantity} ${row.original.unitName}`
        : "\u2014",
  },
  {
    accessorKey: "plannedDate",
    header: ({ column }) => <SortableHeader column={column} label="Planned Date" />,
    cell: ({ row }) => formatDate(row.original.plannedDate),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <FilterableHeader column={column} label="Status" />,
    filterFn: multiValueFilter,
    cell: ({ row }) => <ManufacturingOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => formatDate(row.original.completedAt),
  },
];

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["manufacturing-orders"]}
      queryFn={async () => {
        const response = await fetch("/api/manufacturing-orders");
        if (!response.ok) {
          throw new Error("Failed to fetch manufacturing orders");
        }

        return response.json();
      }}
      searchAriaLabel="Search manufacturing orders"
      addHref="/manufacturing/orders/new"
      addAriaLabel="Add order"
      emptyMessage="No manufacturing orders yet."
      deleteAction={{
        endpoint: "/api/manufacturing-orders",
        invalidateQueryKeys: [["manufacturing-orders"], ["items"]],
        defaultErrorMessage: "Failed to delete manufacturing orders.",
        confirmTitle: (count) =>
          `Delete ${count} manufacturing order${count !== 1 ? "s" : ""}?`,
        confirmDescription: () =>
          "Draft, completed, or cancelled orders will be soft-deleted and removed from normal views. Released orders must be cancelled first.",
      }}
    />
  );
}
