"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { compareDocumentNumbers } from "@/lib/document-number-format";
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
import { groupPurchaseOrderByResolvedSupplier } from "@/lib/purchasing/resolved-supplier-groups";
import type { PurchaseOrderDetail, PurchaseOrderListRow } from "@/lib/purchasing/types";
import { queryKeys } from "@/lib/client/query-keys";
import { apiJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/client/use-api-mutation";

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
      actionBoundary={{ flushPolicy: "none", requiresPersistedId: true }}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
      }}
    />
  );
}

function makePurchaseBillDialogValues(
  order: PurchaseOrderListRow,
  detail?: PurchaseOrderDetail | null,
): PurchaseBillDialogValues {
  const today = todayIsoDate();
  const groups = detail
    ? groupPurchaseOrderByResolvedSupplier({
        purchaseOrderSupplier: {
          id: detail.supplierId,
          name: detail.supplierName,
          email: detail.supplierEmail,
        },
        suppliersById: new Map(
          detail.additionalCosts
            .filter((cost) => cost.supplierId)
            .map((cost) => [
              cost.supplierId as string,
              {
                id: cost.supplierId as string,
                name: cost.supplierName ?? "Supplier",
                email: cost.supplierEmail,
              },
            ]),
        ),
        lines: detail.lines,
        additionalCosts: detail.additionalCosts,
      }).map((group) => {
        const state =
          detail.accountingGroupStates.find((row) => row.groupKey === group.key) ??
          (group.isPurchaseOrderSupplier
            ? detail.accountingGroupStates.find((row) => row.groupKey === "default")
            : undefined);
        const lineAmount = group.lines.reduce(
          (sum, line) =>
            sum + Number(line.quantityOrdered) * Number(line.unitCost),
          0,
        );
        const costAmount = group.additionalCosts.reduce(
          (sum, cost) => sum + Number(cost.amount),
          0,
        );

        return {
          groupKey: group.key,
          label: group.isPurchaseOrderSupplier ? detail.supplierName : group.supplier.name,
          include: state?.pushStatus !== "pushed",
          invoiceNumber: "",
          accountingPurchaseAccountCode:
            detail.accountingPurchaseAccountCode ??
            order.accountingPurchaseAccountCode ??
            "",
          amount: (lineAmount + costAmount).toFixed(4),
          additionalCostIds: group.additionalCosts.map((cost) => cost.id),
          pushedAt: state?.pushedAt ?? null,
          status: state?.pushStatus ?? null,
          externalNumber: state?.externalDocumentNumber ?? null,
        };
      })
    : undefined;
  const first = groups?.[0];

  return {
    groups,
    invoiceNumber: first?.invoiceNumber ?? "",
    billDate: today,
    dueDate: today,
    accountingPurchaseAccountCode:
      first?.accountingPurchaseAccountCode ??
      order.accountingPurchaseAccountCode ??
      "",
    confirmAdditionalCostsOmitted: false,
  };
}

function PurchaseBillCell({ order }: { order: PurchaseOrderListRow }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState(order.purchaseBillStatus);
  const [manualStatus, setManualStatus] = useState(order.purchaseBillManualStatus);
  const [externalId, setExternalId] = useState(order.purchaseBillExternalId);
  const [externalNumber, setExternalNumber] = useState(
    order.purchaseBillExternalNumber,
  );
  const [values, setValues] = useState<PurchaseBillDialogValues>(() =>
    makePurchaseBillDialogValues(order),
  );

  const xeroAccountsQuery = useQuery({
    queryKey: queryKeys.xeroAccounts.root,
    enabled: dialogOpen,
    queryFn: () =>
      apiJson<{ accounts: XeroAccountOption[] }>("/api/xero/accounts", {
        fallbackError: "Failed to load accounting accounts.",
      }),
  });
  const orderDetailMutation = useMutation({
    mutationKey: ["purchase-order", order.id, "bill-dialog-detail"],
    mutationFn: () =>
      apiJson<PurchaseOrderDetail>(`/api/purchase-orders/${order.id}`, {
        fallbackError: "Failed to load purchase order.",
      }),
    onSuccess: (detail) => {
      setValues(makePurchaseBillDialogValues(order, detail));
    },
  });

  const mutation = useApiMutation({
    invalidates: [queryKeys.purchaseOrders.root],
    mutationKey: ["purchase-order-action", order.id, "purchase-bill"],
    mutationFn: async (input: PurchaseBillDialogValues) => {
      return apiJson<{
        xeroBillId: string | null;
        xeroBillNumber: string | null;
        status: "pushed";
      }>(`/api/purchase-orders/${order.id}/accounting-bill`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-bill"),
        body: input,
        fallbackError: "Failed to create supplier bill.",
        mapError: (_status, body) => {
          const message =
            typeof (body as { error?: unknown } | null)?.error === "string" &&
            (body as { error: string }).error.toLowerCase().includes("not connected")
              ? ACCOUNTING_NOT_CONNECTED_MESSAGE
              : undefined;
          return message ? new Error(message) : undefined;
        },
      });
    },
    onMutate: () => setStatus("pending"),
    onSuccess: async (result) => {
      setStatus("pushed");
      setExternalId(result.xeroBillId);
      setExternalNumber(result.xeroBillNumber);
      setDialogOpen(false);
    },
    onError: () => setStatus("failed"),
  });
  const manualStatusMutation = useApiMutation({
    invalidates: [queryKeys.purchaseOrders.root],
    mutationKey: ["purchase-order-action", order.id, "purchase-bill-manual-status"],
    mutationFn: async (
      nextStatus: "not_billed" | "partly_billed" | "billed",
    ) => {
      return apiJson<{
        purchaseBillManualStatus: "not_billed" | "partly_billed" | "billed" | null;
      }>(`/api/purchase-orders/${order.id}/bill-status`, {
        method: "PATCH",
        headers: createIdempotencyHeaders("purchase-order-bill-status"),
        body: { status: nextStatus },
        fallbackError: "Failed to update bill status.",
      });
    },
    onSuccess: async (result) => {
      setManualStatus(result.purchaseBillManualStatus);
    },
  });

  return (
    <>
      <PurchaseBillActionControl
        status={status}
        manualStatus={manualStatus}
        busy={mutation.isPending}
        externalId={externalId}
        externalNumber={externalNumber}
        disabled={false}
        disabledReason={null}
        onSetManualStatus={(nextStatus) =>
          manualStatusMutation.mutate(nextStatus)
        }
        onCreate={() => {
          setValues(makePurchaseBillDialogValues(order));
          setDialogOpen(true);
          orderDetailMutation.mutate();
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
              : orderDetailMutation.error instanceof Error
                ? orderDetailMutation.error.message
              : null
        }
        pending={mutation.isPending || orderDetailMutation.isPending}
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
        compareDocumentNumbers(String(left ?? ""), String(right ?? ""), "PO"),
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
      queryKey={queryKeys.purchaseOrders.root}
      queryEndpoint="/api/purchase-orders"
      queryErrorMessage="Failed to fetch purchase orders"
      searchAriaLabel="Search purchase orders"
      addHref="/purchasing/order"
      addAriaLabel="New Purchase Order"
      emptyMessage="No purchase orders yet."
      deleteAction={{
        endpoint: "/api/purchase-orders",
        invalidateQueryKeys: [queryKeys.purchaseOrders.root],
        defaultErrorMessage: "Failed to delete purchase orders.",
        confirmTitle: (count) => `Delete ${count} order${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `Unreceived purchase order${count !== 1 ? "s" : ""} will be removed from normal views and expected inventory will be released. Received orders cannot be deleted.`,
      }}
    />
  );
}
