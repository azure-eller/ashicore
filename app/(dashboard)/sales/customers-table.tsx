"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { CUSTOMER_PRICING_TOOLTIP } from "@/lib/tooltip-copy";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { Checkbox } from "@/components/ui/checkbox";
import type { CustomerRow } from "./types";

const columns: ColumnDef<CustomerRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all customers"
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
      <Link
        href={`/sales/customers/${row.original.id}`}
        className="hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "customerCategoryName",
    header: ({ column }) => (
      <FilterableHeader column={column} label="Pricing" tooltip={CUSTOMER_PRICING_TOOLTIP} />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => row.original.customerCategoryName ?? "Everyone",
  },
  {
    accessorKey: "email",
    header: ({ column }) => <SortableHeader column={column} label="Email" />,
    cell: ({ row }) => row.original.email ?? "\u2014",
  },
  {
    accessorKey: "phone",
    header: ({ column }) => <SortableHeader column={column} label="Phone" />,
    cell: ({ row }) => row.original.phone ?? "\u2014",
  },
  {
    accessorKey: "xeroContactId",
    header: ({ column }) => <SortableHeader column={column} label="Reference ID" />,
    cell: ({ row }) =>
      row.original.xeroContactId ? (
        <span className="block max-w-56 truncate" title={row.original.xeroContactId}>
          {row.original.xeroContactId}
        </span>
      ) : (
        "\u2014"
      ),
  },
  {
    accessorKey: "notes",
    header: ({ column }) => <SortableHeader column={column} label="Comment" />,
    cell: ({ row }) =>
      row.original.notes ? (
        <span className="block max-w-96 truncate" title={row.original.notes}>
          {row.original.notes}
        </span>
      ) : (
        "\u2014"
      ),
  },
];

export function CustomersTable({ initialData }: { initialData: CustomerRow[] }) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["customers"]}
      queryFn={async () => {
        const response = await fetch("/api/customers");
        if (!response.ok) {
          throw new Error("Failed to fetch customers");
        }

        return response.json();
      }}
      searchAriaLabel="Search customers"
      addHref="/sales/customers/new"
      addAriaLabel="New Customer"
      emptyMessage="No customers yet."
      deleteAction={{
        endpoint: "/api/customers",
        invalidateQueryKeys: [["customers"]],
        defaultErrorMessage: "Failed to delete customer.",
        confirmTitle: (count) =>
          `Delete ${count} customer${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected customer${count !== 1 ? "s" : ""} will be soft-deleted.`,
      }}
    />
  );
}
