"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/components/sortable-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";
import type { SupplierRow } from "./types";

const columns: ColumnDef<SupplierRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all suppliers"
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
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    cell: ({ row }) => (
      <Link href={`/purchasing/suppliers/${row.original.id}`} className="hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => row.original.code ?? "\u2014",
  },
  {
    accessorKey: "contactName",
    header: "Contact",
    cell: ({ row }) => row.original.contactName ?? "\u2014",
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => row.original.email ?? "\u2014",
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

export function SuppliersTable({ initialData }: { initialData: SupplierRow[] }) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["suppliers"]}
      queryFn={async () => {
        const response = await fetch("/api/suppliers");
        if (!response.ok) {
          throw new Error("Failed to fetch suppliers");
        }

        return response.json();
      }}
      searchAriaLabel="Search suppliers"
      addHref="/purchasing/suppliers/new"
      addAriaLabel="Add supplier"
      emptyMessage="No suppliers yet."
      deleteAction={{
        endpoint: "/api/suppliers",
        invalidateQueryKeys: [["suppliers"]],
        defaultErrorMessage: "Failed to delete supplier.",
        confirmTitle: (count) =>
          `Delete ${count} supplier${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected supplier${count !== 1 ? "s" : ""} will be soft-deleted.`,
      }}
    />
  );
}
