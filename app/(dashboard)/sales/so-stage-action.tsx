"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import {
  AccountingActionConfirmDialog,
  AccountingSyncDialog,
  buildAccountingSyncStages,
  type AccountingActionOptions,
  type AccountingSyncDocument,
  type AccountingSyncStage,
} from "@/components/accounting-sync-status";
import { formatPrice } from "@/lib/format";
import type { SalesOrderDetail, SalesOrderListRow } from "./types";

type ActionError = {
  status: number;
  error: string;
  hasOversell: boolean;
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "orderNumber"
    | "customerName"
    | "customerEmail"
    | "status"
    | "totalAmount"
    | "lines"
    | "hasManufacturableLines"
    | "manufacturableDisabledReason"
  >;
};

type SyncDialogState = {
  title: string;
  description: string;
  stages: AccountingSyncStage[];
  error: string | null;
  isWorking: boolean;
  documentNumber?: string | null;
  showProviderAction?: boolean;
};

function salesOrderAccountingDocument(
  order: SalesOrderDetail | Pick<SalesOrderListRow, "customerName" | "customerEmail">
): AccountingSyncDocument {
  return {
    providerName: "Xero",
    documentLabel: "invoice",
    documentNumber: "xeroInvoiceNumber" in order ? order.xeroInvoiceNumber : null,
    pushStatus: "xeroPushStatus" in order ? order.xeroPushStatus : null,
    pushError: "xeroPushError" in order ? order.xeroPushError : null,
    pushedAt: "xeroPushedAt" in order ? order.xeroPushedAt : null,
    retryCount: "xeroRetryCount" in order ? order.xeroRetryCount : 0,
    emailStatus: "xeroEmailStatus" in order ? order.xeroEmailStatus : null,
    emailError: "xeroEmailError" in order ? order.xeroEmailError : null,
    emailedAt: "xeroEmailedAt" in order ? order.xeroEmailedAt : null,
    emailProviderName: "Xero",
    recipientLabel: order.customerName,
    recipientEmail: order.customerEmail,
  };
}

async function fetchSalesOrderDetail(id: string): Promise<SalesOrderDetail> {
  const response = await fetch(`/api/sales-orders/${id}`);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to refresh sales order.");
  }

  return body as SalesOrderDetail;
}

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);
  const [shipOptions, setShipOptions] = useState<AccountingActionOptions>({
    syncAccounting: true,
    sendEmail: order.customerEmail != null && order.customerEmail.trim() !== "",
  });
  const [syncDialog, setSyncDialog] = useState<SyncDialogState | null>(null);
  const accountingDocument = salesOrderAccountingDocument(order);

  const refreshSalesList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const closeSyncDialog = () => {
    const shouldRefresh = syncDialog?.title === "Sales Order Shipped";
    setSyncDialog(null);
    if (shouldRefresh) {
      void refreshSalesList();
    }
  };

  const openShipDialog = ({
    title,
    description,
    includeAccounting = true,
    includeEmail = true,
  }: {
    title: string;
    description: string;
    includeAccounting?: boolean;
    includeEmail?: boolean;
  }) => {
    setSyncDialog({
      title,
      description,
      stages: buildAccountingSyncStages({
        document: accountingDocument,
        includeAccounting,
        includeEmail,
        isWorking: true,
        localActionLabel: "Ship sales order",
      }),
      error: null,
      isWorking: true,
      documentNumber: null,
      showProviderAction: false,
    });
  };

  const finishShipDialog = async ({
    title,
    description,
    includeAccounting = true,
    includeEmail = true,
  }: {
    title: string;
    description: string;
    includeAccounting?: boolean;
    includeEmail?: boolean;
  }) => {
    const latest = await fetchSalesOrderDetail(order.id);
    const latestDocument = salesOrderAccountingDocument(latest);
    setSyncDialog({
      title,
      description,
      stages: buildAccountingSyncStages({
        document: latestDocument,
        includeAccounting,
        includeEmail,
        localActionLabel: "Ship sales order",
      }),
      error: null,
      isWorking: false,
      documentNumber: includeAccounting ? latestDocument.documentNumber : null,
      showProviderAction: includeAccounting && latestDocument.pushStatus === "pushed",
    });
  };

  const failShipDialog = (message: string) => {
    setSyncDialog({
      title: "Sales Order Not Shipped",
      description: "The sales order was not shipped.",
      stages: [
        {
          id: "local",
          label: "Ship sales order",
          detail: message,
          state: "failed",
        },
      ],
      error: message,
      isWorking: false,
      documentNumber: null,
      showProviderAction: false,
    });
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders(`sales-order-confirm-${order.id}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmOversell: false }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm order.",
          hasOversell: Boolean(body?.oversell),
        } satisfies ActionError;
      }
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await refreshSalesList();
    },
    onError: (error: ActionError) => setActionError(error),
  });

  const shipMutation = useMutation({
    mutationFn: async (options: AccountingActionOptions) => {
      const response = await fetch(`/api/sales-orders/${order.id}/ship`, {
        method: "POST",
        headers: createIdempotencyHeaders(`sales-order-ship-${order.id}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          syncAccounting: options.syncAccounting,
          sendEmail: options.sendEmail,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to ship order.");
      }
    },
    onMutate: (options) => {
      setActionError(null);
      setShipConfirmOpen(false);
      openShipDialog({
        title: "Shipping Sales Order",
        description: options.syncAccounting
          ? "The order will ship, sync an invoice to Xero, and email the customer when enabled."
          : "The order will ship in ERP only.",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
    },
    onSuccess: async (_data, options) => {
      await finishShipDialog({
        title: "Sales Order Shipped",
        description: options.syncAccounting
          ? "ERP shipping is complete. Xero and email results are shown below."
          : "ERP shipping is complete.",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
    },
    onError: (error) => {
      const message = error.message;
      setActionError({ status: 400, error: message, hasOversell: false });
      failShipDialog(message);
    },
  });

  const onlineInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/xero-online-invoice`
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to open online invoice.");
      }
      return body as { url: string };
    },
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      setActionError({ status: 400, error: error.message, hasOversell: false });
    },
  });

  const errorMessage = actionError
    ? actionError.hasOversell
      ? "Oversell — review on the order"
      : actionError.error
    : null;

  if (order.status === "draft") {
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={confirmMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              confirmMutation.mutate();
            }}
          >
            {confirmMutation.isPending ? "Confirming..." : "Confirm"}
          </Button>
          {errorMessage ? (
            <Link
              href={`/sales/orders/${order.id}`}
              className="max-w-xs text-xs text-destructive hover:underline"
            >
              {errorMessage}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (order.status === "confirmed") {
    return (
      <div className="flex items-center justify-end gap-2">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={shipMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              setShipConfirmOpen(true);
            }}
          >
            {shipMutation.isPending ? "Shipping..." : "Ship"}
          </Button>
          {errorMessage ? (
            <Link
              href={`/sales/orders/${order.id}`}
              className="max-w-xs text-xs text-destructive hover:underline"
            >
              {errorMessage}
            </Link>
          ) : null}
        </div>
        {order.hasManufacturableLines ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/manufacturing/orders/new?salesOrderId=${order.id}`}>
              Create MOs
            </Link>
          </Button>
        ) : (
          <DisabledTooltipButton
            label="Create MOs"
            tooltip={
              order.manufacturableDisabledReason ??
              "No manufacturable lines remain on this order."
            }
            variant="ghost"
          />
        )}
        {syncDialog ? (
          <AccountingSyncDialog
            open
            title={syncDialog.title}
            description={syncDialog.description}
            stages={syncDialog.stages}
            error={syncDialog.error}
            isWorking={syncDialog.isWorking}
            stageActions={
              syncDialog.showProviderAction
                ? {
                    push: {
                      label: "Open online invoice",
                      onClick: () => onlineInvoiceMutation.mutate(),
                      pending: onlineInvoiceMutation.isPending,
                    },
                  }
                : undefined
            }
            onOpenChange={(open) => {
              if (!open) closeSyncDialog();
            }}
            onDone={closeSyncDialog}
          />
        ) : null}
        <AccountingActionConfirmDialog
          open={shipConfirmOpen}
          title="Ship Sales Order"
          description="Review what happens next."
          confirmLabel="Ship"
          pendingLabel="Shipping..."
          localStep={{
            title: "Ship order",
            detail: order.orderNumber,
            meta: `${order.customerName} · ${formatPrice(order.totalAmount) ?? "-"} · ${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"}`,
          }}
          accountingStep={{
            title: "Create invoice",
            detail: "Invoice",
            meta: "Xero",
          }}
          emailStep={{
            title: "Email customer",
            detail: order.customerEmail ?? "No customer email",
            meta: order.customerName,
          }}
          options={shipOptions}
          onOptionsChange={setShipOptions}
          onConfirm={() => shipMutation.mutate(shipOptions)}
          onOpenChange={setShipConfirmOpen}
          isPending={shipMutation.isPending}
        />
      </div>
    );
  }

  return null;
}
