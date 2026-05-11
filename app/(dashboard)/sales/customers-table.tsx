"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { CUSTOMER_PRICING_TOOLTIP } from "@/lib/tooltip-copy";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { DateTimeText } from "@/components/date-time-text";
import { Checkbox } from "@/components/ui/checkbox";
import { formatAddressLines } from "@/lib/format";
import type { CustomerRow } from "./types";

function customerListAddress(customer: CustomerRow) {
  const billingAddress = formatAddressLines({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  }).join(", ");

  if (billingAddress) return billingAddress;

  return formatAddressLines({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  }).join(", ");
}

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
    id: "address",
    accessorFn: customerListAddress,
    header: ({ column }) => <SortableHeader column={column} label="Address" />,
    cell: ({ row }) => {
      const address = customerListAddress(row.original);
      return address ? (
        <span className="block max-w-80 truncate" title={address}>
          {address}
        </span>
      ) : (
        "\u2014"
      );
    },
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => row.original.email ?? "\u2014",
  },
  {
    accessorKey: "phone",
    header: "Phone",
    cell: ({ row }) => row.original.phone ?? "\u2014",
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => <SortableHeader column={column} label="Updated" />,
    sortingFn: (a, b) =>
      new Date(a.original.updatedAt).getTime() -
      new Date(b.original.updatedAt).getTime(),
    cell: ({ row }) => <DateTimeText value={row.original.updatedAt} />,
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
