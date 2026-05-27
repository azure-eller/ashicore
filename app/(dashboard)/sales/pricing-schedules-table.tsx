"use client";

import Link from "next/link";
import type { ICellRendererParams } from "ag-grid-community";
import { DateTimeText } from "@/components/date-time-text";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import {
  PRICING_BREAKS_TOOLTIP,
  PRICING_ITEM_CATEGORY_TOOLTIP,
  PRICING_SCOPE_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { PricingScheduleRow } from "./types";

const columns: ColDef<PricingScheduleRow>[] = [
  {
    field: "name",
    headerName: "Schedule",
    width: 280,
    minWidth: 200,
    flex: 1.2,
    cellRenderer: ({ data }: ICellRendererParams<PricingScheduleRow>) =>
      data ? (
        <Link
          href={`/sales/pricing/schedules/${data.id}/edit`}
          className="hover:underline"
        >
          {data.name}
        </Link>
      ) : null,
  },
  {
    field: "customerScopeLabel",
    headerName: "Scope",
    headerTooltip: PRICING_SCOPE_TOOLTIP,
    width: 220,
    minWidth: 170,
    flex: 1,
  },
  {
    field: "itemScopeLabel",
    headerName: "Items",
    headerTooltip: PRICING_ITEM_CATEGORY_TOOLTIP,
    width: 260,
    minWidth: 190,
    flex: 1,
  },
  {
    field: "breakSummary",
    headerName: "Breaks",
    headerTooltip: PRICING_BREAKS_TOOLTIP,
    width: 280,
    minWidth: 200,
    flex: 1,
  },
  {
    field: "updatedAt",
    headerName: "Updated",
    width: 190,
    comparator: (left, right) =>
      new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime(),
    cellRenderer: ({ data }: ICellRendererParams<PricingScheduleRow>) =>
      data ? <DateTimeText value={data.updatedAt} /> : null,
  },
];

export function PricingSchedulesTable({
  initialData,
}: {
  initialData: PricingScheduleRow[];
}) {
  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
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
