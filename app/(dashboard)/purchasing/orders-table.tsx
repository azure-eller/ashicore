"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { formatDate, formatPrice } from "@/lib/format";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { PurchaseOrderStatusBadge } from "./status-badge";
import type { PurchaseOrderListRow } from "./types";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

async function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseOrderStatus,
) {
  const response = await fetch(`/api/purchase-orders/${id}/status`, {
    method: "PATCH",
    headers: createIdempotencyHeaders("purchase-order-status", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ status }),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to update purchase order status.");
  }

  return body as { id: string };
}

function createColumns({
  onStatusChange,
  statusPending,
}: {
  onStatusChange: (id: string, status: PurchaseOrderStatus) => void;
  statusPending: boolean;
}): ColDef<PurchaseOrderListRow>[] {
  return [
    {
      field: "orderNumber",
      headerName: "Order",
      width: 150,
      minWidth: 130,
      cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
        data ? (
          <Link
            href={`/purchasing/orders/${data.id}`}
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
        data ? (
          <PurchaseOrderStatusBadge
            status={data.status}
            disabled={statusPending}
            onStatusChange={(status) => onStatusChange(data.id, status)}
          />
        ) : null,
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
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PurchaseOrderStatus }) =>
      updatePurchaseOrderStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  const columns = useMemo(
    () =>
      createColumns({
        statusPending: statusMutation.isPending,
        onStatusChange: (id, status) => statusMutation.mutate({ id, status }),
      }),
    [statusMutation],
  );

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
          `Unreceived purchase order${count !== 1 ? "s" : ""} will be removed from normal views and expected inventory will be released. Received orders cannot be deleted.`,
      }}
    />
  );
}
