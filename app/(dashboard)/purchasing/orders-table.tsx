"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatPrice } from "@/lib/format";
import { PurchaseOrderStatusBadge } from "./status-badge";
import type { PurchaseOrderListRow } from "./types";

const columns: ColumnDef<PurchaseOrderListRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all purchase orders"
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
      <Link href={`/purchasing/orders/${row.original.id}`} className="hover:underline">
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "supplierName",
    header: ({ column }) => <SortableHeader column={column} label="Supplier" />,
  },
  {
    accessorKey: "itemSummary",
    header: "Materials",
  },
  {
    accessorKey: "totalAmount",
    header: ({ column }) => <SortableHeader column={column} label="Total" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.totalAmount) - parseFloat(b.original.totalAmount),
    cell: ({ row }) => formatPrice(row.original.totalAmount) ?? "\u2014",
  },
  {
    accessorKey: "status",
    header: ({ column }) => <FilterableHeader column={column} label="Status" />,
    filterFn: multiValueFilter,
    cell: ({ row }) => <PurchaseOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "expectedDate",
    header: ({ column }) => <SortableHeader column={column} label="Expected" />,
    cell: ({ row }) => formatDate(row.original.expectedDate),
  },
];

export function OrdersTable({ initialData }: { initialData: PurchaseOrderListRow[] }) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["purchase-orders"]}
      queryFn={async () => {
        const response = await fetch("/api/purchase-orders");
        if (!response.ok) {
          throw new Error("Failed to fetch purchase orders");
        }

        return response.json();
      }}
      searchAriaLabel="Search purchase orders"
      addHref="/purchasing/orders/new"
      addAriaLabel="New Purchase Order"
      emptyMessage="No purchase orders yet."
      deleteAction={{
        endpoint: "/api/purchase-orders",
        invalidateQueryKeys: [["purchase-orders"]],
        defaultErrorMessage: "Failed to delete purchase orders.",
        confirmTitle: (count) =>
          `Delete ${count} order${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected purchase order${count !== 1 ? "s" : ""} will be soft-deleted.`,
      }}
    />
  );
}
