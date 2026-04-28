"use client";

import Link from "next/link";
import { useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import {
  AccountingActionConfirmDialog,
  AccountingSyncDialog,
  AccountingSyncStatus,
  buildAccountingSyncStages,
  type AccountingActionOptions,
  type AccountingSyncDocument,
  type AccountingSyncStage,
} from "@/components/accounting-sync-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import { TooltipHeader } from "@/components/tooltip-header";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OVERSELL_TOOLTIP_COPY } from "@/lib/tooltip-copy";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { ManufacturingOrderStatusBadge } from "@/app/(dashboard)/manufacturing/status-badge";
import { SalesOrderStatusBadge } from "./status-badge";
import type {
  OversellWarningPayload,
  SalesOrderDetail as SalesOrderDetailType,
} from "./types";

type ActionError = {
  status?: number;
  error?: string;
  oversell?: OversellWarningPayload;
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

async function fetchSalesOrderDetail(id: string): Promise<SalesOrderDetailType> {
  const response = await fetch(`/api/sales-orders/${id}`);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to refresh sales order.");
  }

  return body as SalesOrderDetailType;
}

function salesOrderAccountingDocument(
  order: SalesOrderDetailType
): AccountingSyncDocument {
  return {
    providerName: "Xero",
    documentLabel: "invoice",
    documentNumber: order.xeroInvoiceNumber,
    pushStatus: order.xeroPushStatus,
    pushError: order.xeroPushError,
    pushedAt: order.xeroPushedAt,
    retryCount: order.xeroRetryCount,
    emailStatus: order.xeroEmailStatus,
    emailError: order.xeroEmailError,
    emailedAt: order.xeroEmailedAt,
    emailProviderName: "Resend",
    recipientLabel: order.customerName,
    recipientEmail: order.customerEmail,
  };
}

export function OrderDetail({
  order,
  canViewLedger = false,
}: {
  order: SalesOrderDetailType;
  canViewLedger?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);
  const [shipOptions, setShipOptions] = useState<AccountingActionOptions>({
    syncAccounting: true,
    sendEmail: order.customerEmail != null && order.customerEmail.trim() !== "",
  });
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncDialog, setSyncDialog] = useState<SyncDialogState | null>(null);
  const accountingDocument = salesOrderAccountingDocument(order);

  const openSyncDialog = ({
    title,
    description,
    localActionLabel,
    includeAccounting = true,
    includeEmail = true,
    activeStage = "push",
  }: {
    title: string;
    description: string;
    localActionLabel: string;
    includeAccounting?: boolean;
    includeEmail?: boolean;
    activeStage?: "push" | "email";
  }) => {
    setSyncDialog({
      title,
      description,
      stages: buildAccountingSyncStages({
        document: accountingDocument,
        includeAccounting,
        includeEmail,
        isWorking: true,
        localActionLabel,
        activeStage,
      }),
      error: null,
      isWorking: true,
      documentNumber: null,
      showProviderAction: false,
    });
  };

  const finishSyncDialog = async ({
    title,
    description,
    localActionLabel,
    includeAccounting = true,
    includeEmail = true,
  }: {
    title: string;
    description: string;
    localActionLabel: string;
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
        localActionLabel,
      }),
      error: null,
      isWorking: false,
      documentNumber: includeAccounting ? latestDocument.documentNumber : null,
      showProviderAction: includeAccounting && latestDocument.pushStatus === "pushed",
    });
  };

  const failSyncDialog = ({
    title,
    description,
    localActionLabel,
    message,
  }: {
    title: string;
    description: string;
    localActionLabel: string;
    message: string;
  }) => {
    setSyncDialog({
      title,
      description,
      stages: [
        {
          id: "local",
          label: localActionLabel,
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "DELETE",
        headers: createIdempotencyHeaders("sales-order-delete"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.push("/sales/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        headers: createIdempotencyHeaders("sales-order-cancel", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ status: "cancelled" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (confirmOversell: boolean) => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-confirm", {
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
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setOversellWarning(null);
      router.refresh();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }

      setActionError(error.error ?? "Failed to confirm order.");
    },
  });

  const shipMutation = useMutation({
    mutationFn: async (options: AccountingActionOptions) => {
      const response = await fetch(`/api/sales-orders/${order.id}/ship`, {
        method: "POST",
        headers: createIdempotencyHeaders("sales-order-ship", {
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
      openSyncDialog({
        title: "Shipping Sales Order",
        description: options.syncAccounting
          ? "The order will ship, sync an invoice to Xero, and email the customer when enabled."
          : "The order will ship in ERP only.",
        localActionLabel: "Ship sales order",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
    },
    onSuccess: async (_data, options) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      await finishSyncDialog({
        title: "Sales Order Shipped",
        description: options.syncAccounting
          ? "ERP shipping is complete. Xero and email results are shown below."
          : "ERP shipping is complete.",
        localActionLabel: "Ship sales order",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Sales Order Not Shipped",
        description: "The sales order was not shipped.",
        localActionLabel: "Ship sales order",
        message: error.message,
      });
    },
  });

  const xeroPushMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/xero-push`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to push invoice to Xero.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Syncing Invoice",
        description: "The invoice will be retried in Xero and emailed when eligible.",
        localActionLabel: "Start retry",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      await finishSyncDialog({
        title: "Invoice Sync Complete",
        description: "The latest Xero and email results are shown below.",
        localActionLabel: "Start retry",
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Invoice Sync Failed",
        description: "The retry did not complete.",
        localActionLabel: "Start retry",
        message: error.message,
      });
    },
  });

  const xeroEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/xero-email`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to email invoice.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Emailing Invoice",
        description: "Sending the existing invoice to the customer.",
        localActionLabel: "Prepare email",
        activeStage: "email",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      await finishSyncDialog({
        title: "Invoice Email Complete",
        description: "The latest email result is shown below.",
        localActionLabel: "Prepare email",
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Invoice Email Failed",
        description: "The email retry did not complete.",
        localActionLabel: "Prepare email",
        message: error.message,
      });
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
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = order.deletedAt != null;
  const canEdit = !isDeleted && order.status === "draft";
  const canConfirm = !isDeleted && order.status === "draft";
  const canShip = !isDeleted && order.status === "confirmed";
  const canCancel = !isDeleted && order.status === "confirmed";
  const canDelete = !isDeleted;
  const canDownloadBol = order.status === "shipped";
  const canRetryXeroPush =
    order.status === "shipped" &&
    (order.xeroPushStatus === "failed" || order.xeroPushStatus === "pending");
  const canRetryXeroEmail =
    order.status === "shipped" &&
    order.xeroPushStatus === "pushed" &&
    order.xeroEmailStatus === "failed";
  const canCreateMOs = !isDeleted && order.status === "confirmed";
  const createMOHref = `/manufacturing/orders/new?salesOrderId=${order.id}`;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/sales/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <SalesOrderStatusBadge status={order.status} />
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <DetailPageActions
            editHref={canEdit ? `/sales/orders/${order.id}/edit` : undefined}
            menu={[
              ...(canViewLedger
                ? [
                    {
                      label: "View inventory activity",
                      onSelect: () =>
                        router.push(
                          buildInventoryLedgerHref({
                            documentType: "sales_order",
                            documentId: order.id,
                          })
                        ),
                    },
                  ]
                : []),
              ...(canDownloadBol
                ? [
                    {
                      label: "Download BOL",
                      onSelect: () => {
                        window.open(
                          `/api/sales-orders/${order.id}/bol`,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      },
                    },
                  ]
                : []),
              ...(canRetryXeroPush
                ? [
                    {
                      label: "Retry Xero push",
                      onSelect: () => xeroPushMutation.mutate(),
                      disabled: xeroPushMutation.isPending,
                    },
                  ]
                : []),
              ...(canRetryXeroEmail
                ? [
                    {
                      label: "Retry Xero email",
                      onSelect: () => xeroEmailMutation.mutate(),
                      disabled: xeroEmailMutation.isPending,
                    },
                  ]
                : []),
              ...(canCancel
                ? [
                    {
                      label: "Cancel order",
                      onSelect: () => setCancelOpen(true),
                      disabled: cancelMutation.isPending,
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      label: "Delete",
                      onSelect: () => setDeleteOpen(true),
                      disabled: deleteMutation.isPending,
                      destructive: true,
                    },
                  ]
                : []),
            ]}
          >
            {canConfirm ? (
              <Button
                size="sm"
                onClick={() => confirmMutation.mutate(false)}
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm"}
              </Button>
            ) : null}
            {canShip ? (
          <Button
                size="sm"
                onClick={() => setShipConfirmOpen(true)}
                disabled={shipMutation.isPending}
              >
                {shipMutation.isPending ? "Shipping..." : "Ship"}
              </Button>
            ) : null}
            {canCreateMOs &&
              (order.hasManufacturableLines ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={createMOHref}>Create MOs</Link>
                </Button>
              ) : (
                <DisabledTooltipButton
                  label="Create MOs"
                  tooltip={
                    order.manufacturableDisabledReason ??
                    "No manufacturable lines remain on this order."
                  }
                />
              ))}
          </DetailPageActions>
        </div>

        <Separator />

        {order.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{order.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <AccountingSyncStatus
          document={accountingDocument}
          onRetryPush={canRetryXeroPush ? () => xeroPushMutation.mutate() : undefined}
          retryPushPending={xeroPushMutation.isPending}
          onRetryEmail={canRetryXeroEmail ? () => xeroEmailMutation.mutate() : undefined}
          retryEmailPending={xeroEmailMutation.isPending}
          providerAction={
            order.xeroPushStatus === "pushed"
              ? {
                  label: "Open online invoice",
                  onClick: () => onlineInvoiceMutation.mutate(),
                  pending: onlineInvoiceMutation.isPending,
                }
              : undefined
          }
          compact
        />

        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Customer</dt>
            <dd className="mt-1 text-sm">{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <SalesOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Requested Date</dt>
            <dd className="mt-1 text-sm">{formatDate(order.requestedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Manufacturable Lines</dt>
            <dd className="mt-1 text-sm">{order.manufacturableLineCount}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Total</dt>
            <dd className="mt-1 text-sm">{formatPrice(order.totalAmount) ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.updatedAt)}</dd>
          </div>
          {order.deletedAt && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Deleted</dt>
              <dd className="mt-1 text-sm">{formatDateTime(order.deletedAt)}</dd>
            </div>
          )}
        </dl>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Lines</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Link
                        href={itemDetailHref("product", line.itemId)}
                        className="hover:underline"
                      >
                        {line.itemName}
                      </Link>
                    </TableCell>
                    <TableCell>{line.itemSku ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell>{line.unitName}</TableCell>
                    <TableCell className="text-right">
                      <div>
                        <div>{formatPrice(line.unitPrice) ?? "\u2014"}</div>
                        {line.suggestedUnitPrice && (
                          <div className="text-xs text-muted-foreground">
                            Suggested {formatPrice(line.suggestedUnitPrice) ?? "\u2014"}
                            {line.pricingSourceType === "schedule_break" &&
                            line.pricingScheduleName
                              ? ` from ${line.pricingScheduleName}${
                                  line.pricingBreakLabel
                                    ? `, ${line.pricingBreakLabel}`
                                    : ""
                                }`
                              : " from base price"}
                            {line.isPriceOverridden ? " · Manual override" : ""}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.lineTotal) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">
              Linked Manufacturing Orders
            </h2>
            {canCreateMOs &&
              (order.hasManufacturableLines ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={createMOHref}>Open Create MOs</Link>
                </Button>
              ) : (
                <DisabledTooltipButton
                  label="Open Create MOs"
                  tooltip={
                    order.manufacturableDisabledReason ??
                    "No manufacturable lines remain on this order."
                  }
                />
              ))}
          </div>

          {order.linkedManufacturingOrders.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MO</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.linkedManufacturingOrders.map((manufacturingOrder) => (
                    <TableRow key={manufacturingOrder.id}>
                      <TableCell>
                        <Link
                          href={`/manufacturing/orders/${manufacturingOrder.id}`}
                          className="hover:underline"
                        >
                          {manufacturingOrder.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{manufacturingOrder.productName}</div>
                          {manufacturingOrder.productSku && (
                            <p className="text-xs text-muted-foreground">
                              {manufacturingOrder.productSku}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {manufacturingOrder.plannedQuantity}
                      </TableCell>
                      <TableCell>{manufacturingOrder.unitName}</TableCell>
                      <TableCell>
                        <ManufacturingOrderStatusBadge status={manufacturingOrder.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-4 py-6">
              <p className="text-sm text-muted-foreground">
                No manufacturing orders have been created from this sales order yet.
              </p>
            </div>
          )}
        </div>
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
            if (!open) setSyncDialog(null);
          }}
          onDone={() => setSyncDialog(null)}
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

      <AlertDialog open={oversellWarning != null} onOpenChange={(open) => {
        if (!open) {
          setOversellWarning(null);
        }
      }}>
        <AlertDialogContent className="max-w-5xl bg-background text-foreground">
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
                  <TableHead>Current Stock</TableHead>
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
                  <TableHead>Added Qty</TableHead>
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
                          <div className="text-xs text-muted-foreground">{product.itemSku}</div>
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
                    <TableCell className={product.projectedShortageQty > 0 ? "text-destructive" : undefined}>
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

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, but it will stop contributing to committed quantity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will be soft-deleted and removed from normal views while its saved line items remain in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
