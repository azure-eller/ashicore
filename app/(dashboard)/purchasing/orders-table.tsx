"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { formatDate, formatPrice } from "@/lib/format";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { purchaseOrderStatusConfig } from "@/components/card-page/order-status-configs";
import type { PurchaseOrderListRow } from "./types";

function PurchaseStatusCell({ order }: { order: PurchaseOrderListRow }) {
  const queryClient = useQueryClient();
  return (
    <OrderStatusControl
      config={purchaseOrderStatusConfig}
      ctx={{ orderId: order.id, status: order.status }}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      }}
    />
  );
}

function PurchaseBillStatusCell({ order }: { order: PurchaseOrderListRow }) {
  if (order.purchaseBillStatus === "pushed") {
    return (
      <span className="text-sm">
        {order.purchaseBillExternalNumber ?? "Bill created"}
      </span>
    );
  }
  if (order.purchaseBillStatus === "pending") {
    return <span className="text-sm text-muted-foreground">Syncing</span>;
  }
  if (order.purchaseBillStatus === "failed") {
    return (
      <span className="text-sm text-destructive" title={order.purchaseBillError ?? undefined}>
        Sync failed
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">Not billed</span>;
}

function createColumns(): ColDef<PurchaseOrderListRow>[] {
  return [
    {
      field: "orderNumber",
      headerName: "Order",
      width: 150,
      minWidth: 130,
      cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
        data ? (
          <Link
            href={`/purchasing/order/${data.id}`}
            className="hover:underline"
          >
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
        data ? <PurchaseStatusCell order={data} /> : null,
    },
    {
      field: "purchaseBillStatus",
      headerName: "Bill",
      width: 150,
      cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
        data ? <PurchaseBillStatusCell order={data} /> : null,
    },
    {
      field: "expectedDate",
      headerName: "Expected",
      headerTooltip: EXPECTED_DELIVERY_DATE_TOOLTIP,
      width: 150,
      valueFormatter: ({ value }) => formatDate(value as string | null),
    },
  ];
}

export function OrdersTable({
  initialData,
}: {
  initialData: PurchaseOrderListRow[];
}) {
  const columns = useMemo(() => createColumns(), []);

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
      addHref="/purchasing/order"
      addAriaLabel="New Purchase Order"
      emptyMessage="No purchase orders yet."
      deleteAction={{
        endpoint: "/api/purchase-orders",
        invalidateQueryKeys: [["purchase-orders"]],
        defaultErrorMessage: "Failed to delete purchase orders.",
        confirmTitle: (count) =>
          `Delete ${count} order${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `Unreceived purchase order${count !== 1 ? "s" : ""} will be removed from normal views and expected inventory will be released. Received orders cannot be deleted.`,
      }}
    />
  );
}
