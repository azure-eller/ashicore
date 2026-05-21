"use client";

import Link from "next/link";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { CUSTOMER_PRICING_TOOLTIP } from "@/lib/tooltip-copy";
import type { CustomerRow } from "./types";

const columns: ColDef<CustomerRow>[] = [
  {
    field: "name",
    headerName: "Name",
    width: 260,
    minWidth: 190,
    flex: 1.2,
    cellRenderer: ({ data }: ICellRendererParams<CustomerRow>) =>
      data ? (
        <Link href={`/sales/customers/${data.id}`} className="hover:underline">
          {data.name}
        </Link>
      ) : null,
  },
  {
    field: "customerCategoryName",
    headerName: "Pricing",
    headerTooltip: CUSTOMER_PRICING_TOOLTIP,
    width: 170,
    valueFormatter: ({ value }) => value ?? "Everyone",
  },
  {
    field: "email",
    headerName: "Email",
    width: 260,
    minWidth: 180,
    flex: 1,
    valueFormatter: ({ value }) => value ?? "—",
  },
  {
    field: "phone",
    headerName: "Phone",
    width: 160,
    valueFormatter: ({ value }) => value ?? "—",
  },
  {
    field: "xeroContactId",
    headerName: "Reference ID",
    width: 190,
    cellRenderer: ({ data }: ICellRendererParams<CustomerRow>) =>
      data?.xeroContactId ? (
        <span title={data.xeroContactId}>{data.xeroContactId}</span>
      ) : (
        "—"
      ),
  },
  {
    field: "notes",
    headerName: "Comment",
    width: 280,
    minWidth: 180,
    flex: 1,
    cellRenderer: ({ data }: ICellRendererParams<CustomerRow>) =>
      data?.notes ? <span title={data.notes}>{data.notes}</span> : "—",
  },
];

export function CustomersTable({ initialData }: { initialData: CustomerRow[] }) {
  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={["customers"]}
      queryFn={async () => {
        const response = await fetch("/api/customers");
        if (!response.ok) {
          throw new Error("Failed to fetch customers");
        }

        return response.json();
      }}
      searchAriaLabel="Search customers"
      addHref="/sales/customer"
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
