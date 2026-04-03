"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { SortableHeader } from "@/components/sortable-header";
import { formatDate } from "@/lib/format";
import type { CustomerCategoryRow } from "./types";

const columns: ColumnDef<CustomerCategoryRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all customer categories"
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
    header: ({ column }) => <SortableHeader column={column} label="Category" />,
    cell: ({ row }) => (
      <Link
        href={`/sales/pricing/categories/${row.original.id}/edit`}
        className="hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => row.original.description ?? "\u2014",
  },
  {
    accessorKey: "customerCount",
    header: "Customers",
  },
  {
    accessorKey: "scheduleCount",
    header: "Schedules",
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

export function CustomerCategoriesTable({
  initialData,
}: {
  initialData: CustomerCategoryRow[];
}) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["customer-categories"]}
      queryFn={async () => {
        const response = await fetch("/api/customer-categories");
        if (!response.ok) {
          throw new Error("Failed to fetch customer categories");
        }

        return response.json();
      }}
      searchAriaLabel="Search customer categories"
      addHref="/sales/pricing/categories/new"
      addAriaLabel="Add customer category"
      emptyMessage="No customer categories yet."
      deleteAction={{
        endpoint: "/api/customer-categories",
        invalidateQueryKeys: [["customer-categories"]],
        defaultErrorMessage: "Failed to delete customer categories.",
        confirmTitle: (count) =>
          `Delete ${count} customer categor${count === 1 ? "y" : "ies"}?`,
        confirmDescription: () =>
          "The selected customer categories will be soft-deleted.",
      }}
    />
  );
}
