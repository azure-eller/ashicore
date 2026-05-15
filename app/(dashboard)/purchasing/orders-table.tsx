"use client";

import Link from "next/link";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { formatDate, formatPrice } from "@/lib/format";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { PurchaseOrderStatusBadge } from "./status-badge";
import type { PurchaseOrderListRow } from "./types";

const columns: ColDef<PurchaseOrderListRow>[] = [
  {
    field: "orderNumber",
    headerName: "Order",
    width: 150,
    minWidth: 130,
    cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
      data ? (
        <Link href={`/purchasing/orders/${data.id}`} className="hover:underline">
          {data.orderNumber}
        </Link>
      ) : null,
    comparator: (left, right) =>
      String(left ?? "").localeCompare(String(right ?? ""), undefined, {
        numeric: true,
      }),
  },
  {
    field: "supplierName",
    headerName: "Supplier",
    width: 240,
    minWidth: 180,
    flex: 1,
  },
  {
    field: "itemSummary",
    headerName: "Materials",
    width: 300,
    minWidth: 220,
    flex: 1.2,
  },
  {
    field: "totalAmount",
    headerName: "Total",
    width: 130,
    comparator: (left, right) =>
      parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
    valueFormatter: ({ value }) => formatPrice(String(value ?? "")) ?? "—",
  },
  {
    field: "status",
    headerName: "Status",
    headerTooltip: PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP,
    width: 150,
    cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
      data ? <PurchaseOrderStatusBadge status={data.status} /> : null,
  },
  {
    field: "expectedDate",
    headerName: "Expected",
    headerTooltip: EXPECTED_DELIVERY_DATE_TOOLTIP,
    width: 150,
    valueFormatter: ({ value }) => formatDate(value as string | null),
  },
];

export function OrdersTable({ initialData }: { initialData: PurchaseOrderListRow[] }) {
  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
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
