"use client";

import Link from "next/link";
import type { ICellRendererParams } from "ag-grid-community";
import { DateTimeText } from "@/components/date-time-text";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { SUPPLIER_CODE_TOOLTIP } from "@/lib/tooltip-copy";
import type { SupplierRow } from "./types";

const columns: ColDef<SupplierRow>[] = [
  {
    field: "name",
    headerName: "Name",
    width: 240,
    minWidth: 180,
    flex: 1.1,
    cellRenderer: ({ data }: ICellRendererParams<SupplierRow>) =>
      data ? (
        <Link href={`/purchasing/suppliers/${data.id}`} className="hover:underline">
          {data.name}
        </Link>
      ) : null,
  },
  {
    field: "code",
    headerName: "Code",
    headerTooltip: SUPPLIER_CODE_TOOLTIP,
    width: 130,
    valueFormatter: ({ value }) => value ?? "—",
  },
  {
    field: "contactName",
    headerName: "Contact",
    width: 190,
    valueFormatter: ({ value }) => value ?? "—",
  },
  {
    field: "email",
    headerName: "Email",
    width: 260,
    flex: 1,
    valueFormatter: ({ value }) => value ?? "—",
  },
  {
    field: "updatedAt",
    headerName: "Updated",
    width: 190,
    comparator: (left, right) =>
      new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime(),
    cellRenderer: ({ data }: ICellRendererParams<SupplierRow>) =>
      data ? <DateTimeText value={data.updatedAt} /> : null,
  },
];

export function SuppliersTable({ initialData }: { initialData: SupplierRow[] }) {
  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
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
      addAriaLabel="New Supplier"
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
