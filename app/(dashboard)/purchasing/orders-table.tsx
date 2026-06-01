"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { formatDate, formatPrice } from "@/lib/format";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { purchaseOrderStatusConfig } from "@/components/card-page/order-status-configs";
import { PurchaseBillActionControl } from "./purchase-order-workflow-actions";
import {
  PurchaseBillDialog,
  type PurchaseBillDialogValues,
  type XeroAccountOption,
} from "./purchase-order-workflow-dialogs";
import type { PurchaseOrderListRow } from "./types";

const ACCOUNTING_NOT_CONNECTED_MESSAGE =
  "Connect accounting software before creating supplier bills.";

function todayIsoDate() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

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

function makePurchaseBillDialogValues(
  order: PurchaseOrderListRow,
): PurchaseBillDialogValues {
  const today = todayIsoDate();
  return {
    invoiceNumber: "",
    billDate: today,
    dueDate: today,
    accountingPurchaseAccountCode: order.accountingPurchaseAccountCode ?? "",
    confirmAdditionalCostsOmitted: false,
  };
}

function PurchaseBillCell({ order }: { order: PurchaseOrderListRow }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState(order.purchaseBillStatus);
  const [externalId, setExternalId] = useState(order.purchaseBillExternalId);
  const [externalNumber, setExternalNumber] = useState(
    order.purchaseBillExternalNumber,
  );
  const [values, setValues] = useState<PurchaseBillDialogValues>(() =>
    makePurchaseBillDialogValues(order),
  );

  const xeroAccountsQuery = useQuery({
    queryKey: ["xero-accounts"],
    enabled: dialogOpen,
    queryFn: async () => {
      const response = await fetch("/api/xero/accounts");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load accounting accounts.");
      }
      return response.json() as Promise<{ accounts: XeroAccountOption[] }>;
    },
  });

  const mutation = useMutation({
    mutationKey: ["purchase-order-action", order.id, "purchase-bill"],
    mutationFn: async (input: PurchaseBillDialogValues) => {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/accounting-bill`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("purchase-order-bill", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(input),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof body?.error === "string" &&
          body.error.toLowerCase().includes("not connected")
            ? ACCOUNTING_NOT_CONNECTED_MESSAGE
            : body?.error ?? "Failed to create supplier bill.";
        throw new Error(message);
      }

      return body as {
        xeroBillId: string;
        xeroBillNumber: string;
        status: "pushed";
      };
    },
    onMutate: () => setStatus("pending"),
    onSuccess: async (result) => {
      setStatus("pushed");
      setExternalId(result.xeroBillId);
      setExternalNumber(result.xeroBillNumber);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: () => setStatus("failed"),
  });

  const disabledReason =
    order.status === "draft"
      ? "Set this PO to Ordered before creating a supplier bill."
      : order.status === "cancelled"
        ? "Cancelled purchase orders cannot be billed."
        : null;

  return (
    <>
      <PurchaseBillActionControl
        status={status}
        busy={mutation.isPending}
        externalId={externalId}
        externalNumber={externalNumber}
        disabled={Boolean(disabledReason)}
        disabledReason={disabledReason}
        onCreate={() => {
          setValues(makePurchaseBillDialogValues(order));
          setDialogOpen(true);
        }}
      />
      <PurchaseBillDialog
        open={dialogOpen}
        values={values}
        hasAdditionalCosts={order.hasAdditionalCosts}
        additionalCostTotal={order.additionalCostTotal}
        xeroAccounts={xeroAccountsQuery.data?.accounts ?? []}
        error={
          mutation.error instanceof Error
            ? mutation.error.message
            : xeroAccountsQuery.error instanceof Error
              ? xeroAccountsQuery.error.message
              : null
        }
        pending={mutation.isPending}
        onValuesChange={setValues}
        onOpenChange={setDialogOpen}
        onCreate={() => mutation.mutate(values)}
      />
    </>
  );
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
      cellClass: "statusBlockCell",
      cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
        data ? <PurchaseStatusCell order={data} /> : null,
    },
    {
      field: "purchaseBillStatus",
      headerName: "Bill",
      width: 160,
      cellClass: "statusBlockCell",
      cellRenderer: ({ data }: ICellRendererParams<PurchaseOrderListRow>) =>
        data ? <PurchaseBillCell order={data} /> : null,
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
      queryEndpoint="/api/purchase-orders"
      queryErrorMessage="Failed to fetch purchase orders"
      searchAriaLabel="Search purchase orders"
      addHref="/purchasing/order"
      addAriaLabel="New Purchase Order"
      emptyMessage="No purchase orders yet."
      deleteAction={{
        endpoint: "/api/purchase-orders",
        invalidateQueryKeys: [["purchase-orders"]],
        defaultErrorMessage: "Failed to delete purchase orders.",
        confirmTitle: (count) => `Delete ${count} order${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `Unreceived purchase order${count !== 1 ? "s" : ""} will be removed from normal views and expected inventory will be released. Received orders cannot be deleted.`,
      }}
    />
  );
}
