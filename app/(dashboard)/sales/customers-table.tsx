"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { SegmentedCountFilter } from "@/components/segmented-count-filter";
import { apiJson } from "@/lib/client/api";
import { formatDate } from "@/lib/format";
import { CUSTOMER_CATEGORY_TOOLTIP } from "@/lib/tooltip-copy";
import type { CustomerRow } from "@/lib/sales/types";

type CustomerView = "all" | "due";

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
    headerName: "Category",
    headerTooltip: CUSTOMER_CATEGORY_TOOLTIP,
    width: 170,
    valueFormatter: ({ value }) => value ?? "Uncategorized",
  },
  {
    field: "nextActionDueDate",
    headerName: "Due",
    width: 130,
    valueFormatter: ({ value }) => (value ? formatDate(value) : "—"),
  },
  {
    field: "nextAction",
    headerName: "Next action",
    width: 280,
    minWidth: 180,
    flex: 1,
    valueFormatter: ({ value }) => value ?? "—",
    tooltipValueGetter: ({ data }) => data?.nextAction ?? "",
  },
  {
    field: "primaryContactName",
    headerName: "Primary contact",
    width: 220,
    minWidth: 160,
    valueFormatter: ({ data }) => formatPrimaryContact(data),
    tooltipValueGetter: ({ data }) => formatPrimaryContact(data),
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
    valueFormatter: ({ value }) => value ?? "—",
    tooltipValueGetter: ({ data }) => data?.xeroContactId ?? "",
  },
  {
    field: "notes",
    headerName: "Comment",
    width: 280,
    minWidth: 180,
    flex: 1,
    valueFormatter: ({ value }) => value ?? "—",
    tooltipValueGetter: ({ data }) => data?.notes ?? "",
  },
];

export function CustomersTable({
  initialData,
  today,
}: {
  initialData: CustomerRow[];
  today: string;
}) {
  const [view, setView] = useState<CustomerView>("all");
  const filteredRows = useMemo(
    () => filterCustomersForView(initialData, view, today),
    [initialData, today, view]
  );
  const dueCount = useMemo(
    () => initialData.filter((row) => isFollowUpDue(row, today)).length,
    [initialData, today]
  );

  return (
    <ERPDataGridList
      rows={filteredRows}
      columns={columns}
      queryKey={["customers", view]}
      queryFn={async () => {
        const rows = await apiJson<CustomerRow[]>("/api/customers");
        return filterCustomersForView(rows, view, today);
      }}
      queryErrorMessage="Failed to fetch customers"
      searchAriaLabel="Search customers"
      addHref="/sales/customer"
      addAriaLabel="New Customer"
      emptyMessage="No customers yet."
      toolbarContent={
        <SegmentedCountFilter
          value={view}
          ariaLabel="Customer follow-up view"
          options={[
            {
              value: "all",
              label: "All",
              count: initialData.length,
              ariaLabel: "Show all customers",
            },
            {
              value: "due",
              label: "Due",
              count: dueCount,
              ariaLabel: "Show customers with follow-up due today or overdue",
            },
          ]}
          onValueChange={(value) => setView(value || "all")}
        />
      }
      deleteAction={{
        endpoint: "/api/customers",
        invalidateQueryKeys: [["customers"]],
        defaultErrorMessage: "Failed to delete customer.",
        confirmTitle: (count) =>
          `Delete ${count} customer${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected customer${count !== 1 ? "s" : ""} will be soft-deleted. Existing sales orders keep their customer snapshot.`,
      }}
    />
  );
}

function filterCustomersForView(
  rows: CustomerRow[],
  view: CustomerView,
  today: string
) {
  if (view === "due") {
    return rows.filter((row) => isFollowUpDue(row, today));
  }
  return rows;
}

function isFollowUpDue(row: CustomerRow, today: string) {
  return Boolean(row.nextActionDueDate && row.nextActionDueDate <= today);
}

function formatPrimaryContact(row: CustomerRow | null | undefined) {
  if (!row?.primaryContactName) return "—";

  const contactDetails = [row.primaryContactEmail, row.primaryContactPhone]
    .filter(Boolean)
    .join(" · ");
  return contactDetails ? `${row.primaryContactName} · ${contactDetails}` : row.primaryContactName;
}
