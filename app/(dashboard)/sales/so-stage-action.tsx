"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AccountingActionConfirmDialog,
  AccountingSyncDialog,
  buildAccountingSyncStages,
  type AccountingActionOptions,
  type AccountingSyncDocument,
  type AccountingSyncStage,
} from "@/components/accounting-sync-status";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { formatPrice } from "@/lib/format";
import {
  ON_HAND_STOCK_TOOLTIP,
  OVERSELL_TOOLTIP_COPY,
  SALES_ADDED_QTY_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  OversellWarningPayload,
  SalesOrderDetail,
  SalesOrderListRow,
} from "./types";

type ActionError = {
  status: number;
  error: string;
  oversell?: OversellWarningPayload;
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
    | "shippingReadiness"
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
    emailProviderName: "Resend",
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
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
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
    mutationFn: async (confirmOversell: boolean) => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders(`sales-order-confirm-${order.id}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmOversell }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm order.",
          oversell: body?.oversell,
        } satisfies ActionError;
      }
    },
    onMutate: () => {
      setActionError(null);
      setOversellWarning(null);
    },
    onSuccess: async () => {
      await refreshSalesList();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }

      setActionError(error);
    },
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
      setActionError({ status: 400, error: message });
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
      setActionError({ status: 400, error: error.message });
    },
  });

  const errorMessage = actionError?.error ?? null;

  if (order.status === "draft") {
    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={confirmMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                confirmMutation.mutate(false);
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
        <AlertDialog
          open={oversellWarning != null}
          onOpenChange={(open) => {
            if (!open) {
              setOversellWarning(null);
            }
          }}
        >
          <AlertDialogContent
            size="content"
            className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
              <AlertDialogDescription>
                Confirming this order would oversell one or more items.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>
                      <TooltipHeader label="Current Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Available"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentAvailable}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Reserved"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentReserved}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Demand"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentDemand}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Backorder"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentShortage}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Expected"
                        tooltip={OVERSELL_TOOLTIP_COPY.expected}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Safety"
                        tooltip={OVERSELL_TOOLTIP_COPY.safety}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Current Calculated"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentCalculated}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader label="Added Qty" tooltip={SALES_ADDED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Demand"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedDemand}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Backorder"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedShortage}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Calculated"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedCalculated}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {oversellWarning?.products.map((product) => (
                    <TableRow key={product.itemId}>
                      <TableCell>
                        <Link
                          href={itemDetailHref("product", product.itemId)}
                          className="hover:underline"
                        >
                          <div className="font-medium">{product.itemName}</div>
                          {product.itemSku && (
                            <div className="text-xs text-muted-foreground">
                              {product.itemSku}
                            </div>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {product.inStock} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.availableQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.committedQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.demandQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.shortageQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.expectedQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.safetyStock} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.calculatedStock} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.addedQty} {product.unitName}
                      </TableCell>
                      <TableCell>
                        {product.projectedDemandQty} {product.unitName}
                      </TableCell>
                      <TableCell
                        className={
                          product.projectedShortageQty > 0
                            ? "text-destructive"
                            : undefined
                        }
                      >
                        {product.projectedShortageQty} {product.unitName}
                      </TableCell>
                      <TableCell className="text-destructive">
                        {product.projectedCalculatedStock} {product.unitName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(true)}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (order.status === "confirmed") {
    const canShip = false;
    const shouldCreateMOs = order.shippingReadiness.state === "needs_manufacturing";
    const shouldWaitForProduction = order.shippingReadiness.state === "in_production";

    return (
      <>
        <div className="flex items-center justify-end gap-2">
          <div className="flex flex-col items-end gap-1">
            {canShip ? (
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
            ) : shouldWaitForProduction ? (
              <DisabledTooltipButton
                label="In production"
                tooltip={order.shippingReadiness.message}
              />
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/orders/${order.id}`}>Review</Link>
              </Button>
            )}
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
          {shouldCreateMOs ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/manufacturing/orders/new?salesOrderId=${order.id}`}>
                Create MOs
              </Link>
            </Button>
          ) : order.hasManufacturableLines ? (
            <DisabledTooltipButton
              label="Create MOs"
              tooltip={
                order.manufacturableDisabledReason ??
                "No manufacturable lines remain on this order."
              }
              variant="ghost"
            />
          ) : null}
        </div>
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
      </>
    );
  }

  if (order.status === "partially_shipped") {
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/sales/orders/${order.id}`}>Review</Link>
        </Button>
      </div>
    );
  }

  return null;
}
