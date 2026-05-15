"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Download01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import {
  AccountingActionConfirmDialog,
  AccountingSyncDialog,
  AccountingSyncStatus,
  buildAccountingSyncStages,
  type AccountingSyncWarning,
  type AccountingActionOptions,
  type AccountingSyncDocument,
  type AccountingSyncStage,
} from "@/components/accounting-sync-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatAddressLines,
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
  getFieldArrayError,
} from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { captureAppError } from "@/lib/observability/sentry";
import { receivePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  ORDER_TOTAL_TOOLTIP,
  PO_ORDERED_QTY_TOOLTIP,
  PO_RECEIVE_NOW_TOOLTIP,
  PO_RECEIVED_QTY_TOOLTIP,
  PO_REMAINING_QTY_TOOLTIP,
  PURCHASE_UNIT_COST_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
  RECEIPT_DISPOSITION_TOOLTIP,
} from "@/lib/tooltip-copy";
import { PurchaseOrderStatusBadge } from "./status-badge";
import type { PurchaseOrderDetail as PurchaseOrderDetailType } from "./types";

type ApiError = {
  status?: number;
  error?: string;
  errors?: Record<string, string[]>;
  requestId?: string | null;
  receivedLineCount?: number;
  overReceipt?: {
    lines: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }>;
  };
};

function captureReceiveFailure(error: ApiError, orderId: string) {
  if (error.status === 409 && error.overReceipt) return;
  if (error.errors) return;

  const sentryError = new Error("Purchase receive API failed");
  sentryError.name = "PurchaseReceiveApiError";

  captureAppError(sentryError, {
    requestId: error.requestId ?? undefined,
    route: `/api/purchase-orders/${orderId}/receive`,
    method: "POST",
    runtime: "browser",
    module: "purchasing",
    operation: "receive_purchase_order",
    source: "client_mutation",
    appDebug: {
      http_status: error.status,
      received_line_count: error.receivedLineCount,
      has_field_errors: Boolean(error.errors),
      has_over_receipt_warning: Boolean(error.overReceipt),
    },
  });
}

function captureReceiveUnexpectedError(error: Error, orderId: string) {
  captureAppError(error, {
    route: `/api/purchase-orders/${orderId}/receive`,
    method: "POST",
    runtime: "browser",
    module: "purchasing",
    operation: "receive_purchase_order",
    source: "client_mutation",
  });
}

function isApiError(error: unknown): error is ApiError {
  return error != null && typeof error === "object" && "status" in error;
}

const ADDITIONAL_COST_TYPE_LABELS: Record<
  PurchaseOrderDetailType["additionalCosts"][number]["costType"],
  string
> = {
  shipping: "Shipping",
  customs: "Customs",
  other: "Other",
};

const ADDITIONAL_COST_DISTRIBUTION_LABELS: Record<
  PurchaseOrderDetailType["additionalCosts"][number]["distributionMethod"],
  string
> = {
  by_value: "By value",
  not_distributed: "Not distributed",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeBadge({
  file,
}: {
  file: PurchaseOrderDetailType["attachments"][number];
}) {
  const type = file.contentType.includes("pdf")
    ? "PDF"
    : file.contentType.startsWith("image/")
      ? "IMG"
      : file.filename.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";

  return <Badge variant="outline">{type}</Badge>;
}

type ReceiveFormValues = z.input<typeof receivePurchaseOrderSchema>;

type SyncDialogState = {
  title: string;
  description: string;
  stages: AccountingSyncStage[];
  warnings: AccountingSyncWarning[];
  error: string | null;
  isWorking: boolean;
  documentNumber?: string | null;
  documentId?: string | null;
};

async function fetchPurchaseOrderDetail(id: string): Promise<PurchaseOrderDetailType> {
  const response = await fetch(`/api/purchase-orders/${id}`);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to refresh purchase order.");
  }

  return body as PurchaseOrderDetailType;
}

function purchaseOrderAccountingDocument(
  order: PurchaseOrderDetailType
): AccountingSyncDocument {
  return {
    providerName: "Accounting",
    documentLabel: "purchase order",
    documentNumber: order.xeroPurchaseOrderNumber,
    pushStatus: order.xeroPushStatus,
    pushError: order.xeroPushError,
    pushedAt: order.xeroPushedAt,
    retryCount: order.xeroRetryCount,
    emailStatus: order.xeroPoEmailStatus,
    emailError: order.xeroPoEmailError,
    emailedAt: order.xeroPoEmailedAt,
    emailProviderName: "Resend",
    recipientLabel: order.supplierName,
    recipientEmail: order.supplierEmail,
  };
}

function getLineAccountingAddressKey(line: PurchaseOrderDetailType["lines"][number]) {
  const parts = [
    line.shipLine1,
    line.shipLine2,
    line.shipCity,
    line.shipRegion,
    line.shipPostcode,
    line.shipCountry,
  ].map((part) => part?.trim() ?? "");

  return parts.join("\u001f").replace(/^\u001f+|\u001f+$/g, "");
}

function getLineAccountingAddressLabel(line: PurchaseOrderDetailType["lines"][number]) {
  return formatAddressLines({
    line1: line.shipLine1,
    line2: line.shipLine2,
    city: line.shipCity,
    region: line.shipRegion,
    postcode: line.shipPostcode,
    country: line.shipCountry,
  }).join(", ");
}

function getPurchaseOrderAccountingWarnings(
  order: PurchaseOrderDetailType,
  includeAccounting = true
): AccountingSyncWarning[] {
  if (!includeAccounting) return [];

  const addressedLines = order.lines
    .map((line) => ({
      key: getLineAccountingAddressKey(line),
      label: getLineAccountingAddressLabel(line),
    }))
    .filter((line) => line.key !== "");
  const uniqueAddressKeys = new Set(addressedLines.map((line) => line.key));

  if (uniqueAddressKeys.size <= 1) return [];

  return [
    {
      title: "Accounting supports one delivery address.",
      detail: `This sync will use ${addressedLines[0].label}. Other line addresses stay in ERP.`,
    },
  ];
}

export function PurchaseOrderDetail({
  order,
  canViewLedger = false,
}: {
  order: PurchaseOrderDetailType;
  canViewLedger?: boolean;
}) {
  const timeZone = useOrganizationTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
		  const [receiveOpen, setReceiveOpen] = useState(false);
	  const [overReceiptWarning, setOverReceiptWarning] =
	    useState<ApiError["overReceipt"] | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitOptions, setSubmitOptions] = useState<AccountingActionOptions>({
    syncAccounting: false,
    sendEmail: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [syncDialog, setSyncDialog] = useState<SyncDialogState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const accountingDocument = purchaseOrderAccountingDocument(order);
  const additionalCostTotal = order.additionalCosts.reduce(
    (sum, cost) => sum + Number(cost.amount),
    0
  );

  const receiveForm = useForm<ReceiveFormValues>({
    resolver: zodResolver(receivePurchaseOrderSchema),
    mode: "onBlur",
    defaultValues: {
      lines: order.lines.map((line) => ({
        lineId: line.id,
        quantityReceived: null,
        disposition: "available",
      })),
    },
  });

  useEffect(() => {
    receiveForm.reset({
      lines: order.lines.map((line) => ({
        lineId: line.id,
        quantityReceived: null,
        disposition: "available",
      })),
    });
  }, [order.lines, receiveForm, receiveOpen]);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
  };

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
        timeZone,
        document: accountingDocument,
        includeAccounting,
        includeEmail,
        isWorking: true,
        localActionLabel,
        activeStage,
      }),
      error: null,
      warnings: getPurchaseOrderAccountingWarnings(order, includeAccounting),
      isWorking: true,
      documentNumber: null,
      documentId: null,
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
    const latest = await fetchPurchaseOrderDetail(order.id);
    const latestDocument = purchaseOrderAccountingDocument(latest);
    setSyncDialog({
      title,
      description,
      stages: buildAccountingSyncStages({
        timeZone,
        document: latestDocument,
        includeAccounting,
        includeEmail,
        localActionLabel,
      }),
      error: null,
      warnings: getPurchaseOrderAccountingWarnings(latest, includeAccounting),
      isWorking: false,
      documentNumber: includeAccounting ? latestDocument.documentNumber : null,
      documentId: includeAccounting ? latest.xeroPurchaseOrderId : null,
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
      warnings: [],
      error: message,
      isWorking: false,
      documentNumber: null,
      documentId: null,
    });
  };

  const submitMutation = useMutation({
    mutationFn: async (options: AccountingActionOptions) => {
      const response = await fetch(`/api/purchase-orders/${order.id}/submit`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-submit", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          syncAccounting: options.syncAccounting,
          sendEmail: options.sendEmail,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to submit purchase order.");
      }
    },
    onMutate: (options) => {
      setActionError(null);
      setSubmitConfirmOpen(false);
      openSyncDialog({
        title: "Submitting Purchase Order",
        description: options.syncAccounting
          ? "The purchase order will be submitted, synced to accounting, and emailed when enabled."
          : "The purchase order will be submitted in ERP only.",
        localActionLabel: "Submit purchase order",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
    },
    onSuccess: async (_data, options) => {
      await refreshQueries();
      await finishSyncDialog({
        title: "Purchase Order Submitted",
        description: options.syncAccounting
          ? "ERP submission is complete. Accounting and email results are shown below."
          : "ERP submission is complete.",
        localActionLabel: "Submit purchase order",
        includeAccounting: options.syncAccounting,
        includeEmail: options.sendEmail,
      });
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Purchase Order Not Submitted",
        description: "The purchase order was not submitted.",
        localActionLabel: "Submit purchase order",
        message: error.message,
      });
    },
  });

  const xeroPushMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/accounting-push`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body?.error ?? "Failed to sync purchase order."
        );
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Syncing Purchase Order",
        description: "The purchase order will be synced to accounting.",
        localActionLabel: "Start sync",
      });
    },
    onSuccess: async () => {
      await refreshQueries();
      await finishSyncDialog({
        title: "Purchase Order Sync Complete",
        description: "The latest accounting and email results are shown below.",
        localActionLabel: "Start sync",
      });
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Purchase Order Sync Failed",
        description: "The sync did not complete.",
        localActionLabel: "Start sync",
        message: error.message,
      });
    },
  });

  const xeroEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/accounting-email`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to email purchase order.");
      }
    },
    onMutate: () => {
      setActionError(null);
      openSyncDialog({
        title: "Emailing Purchase Order",
        description: "The accounting PDF will be sent through the transactional email provider.",
        localActionLabel: "Prepare email",
        activeStage: "email",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      await finishSyncDialog({
        title: "Purchase Order Email Complete",
        description: "The latest email result is shown below.",
        localActionLabel: "Prepare email",
      });
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
      failSyncDialog({
        title: "Purchase Order Email Failed",
        description: "The email retry did not complete.",
        localActionLabel: "Prepare email",
        message: error.message,
      });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async (values: ReceiveFormValues) => {
      const response = await fetch(`/api/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-receive", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError: ApiError = {
          status: response.status,
          error: body?.error ?? "Failed to receive purchase order.",
          errors: body?.errors,
          overReceipt: body?.overReceipt,
          requestId:
            response.headers.get("x-erp-request-id") ??
            response.headers.get("x-request-id") ??
            body?.requestId,
          receivedLineCount: values.lines.length,
        };

        captureReceiveFailure(apiError, order.id);
        throw apiError;
      }
    },
    onMutate: () => {
      setActionError(null);
      receiveForm.clearErrors();
    },
    onSuccess: async () => {
      await refreshQueries();
      setReceiveOpen(false);
      setOverReceiptWarning(null);
      router.refresh();
    },
    onError: (error: ApiError | Error) => {
      if (!isApiError(error)) {
        captureReceiveUnexpectedError(error, order.id);
        setActionError(error.message || "Failed to receive purchase order.");
        return;
      }

      if (error.status === 409 && error.overReceipt) {
        setOverReceiptWarning(error.overReceipt);
        return;
      }
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          receiveForm.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setActionError(error.error ?? "Failed to receive purchase order.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/purchase-orders/${order.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete purchase order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setDeleteOpen(false);
      router.push("/purchasing/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/purchase-orders/${order.id}/files`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to upload file.");
      }
    },
    onMutate: () => setFileActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.refresh();
    },
    onError: (error) => setFileActionError(error.message),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/files/${fileId}`,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete file.");
      }
    },
    onMutate: () => setFileActionError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.refresh();
    },
    onError: (error) => setFileActionError(error.message),
  });

  function handleFileInput(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => uploadFileMutation.mutate(file));
  }

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/purchase-orders/${order.id}/duplicate`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-duplicate"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to duplicate purchase order.");
      }
      return body as { id: string };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.push(`/purchasing/orders/${created.id}`);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = order.deletedAt != null;
  const canEdit = !isDeleted;
  const canSubmit = !isDeleted && order.status === "draft";
  const canReceive = !isDeleted && ["ordered", "partial"].includes(order.status);
  const canDelete = !isDeleted;
  const canSyncAccounting =
    !isDeleted && ["ordered", "partial", "received"].includes(order.status);
  const canRetryXeroEmail =
    !isDeleted &&
    ["ordered", "partial", "received"].includes(order.status) &&
    order.xeroPushStatus === "pushed" &&
    order.xeroPoEmailStatus === "failed";
  const receiveLinesError = getFieldArrayError(receiveForm.formState.errors.lines);

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/purchasing/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <PurchaseOrderStatusBadge status={order.status} />
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <DetailPageActions
            editHref={canEdit ? `/purchasing/orders/${order.id}/edit` : undefined}
            menu={[
              ...(canViewLedger
                ? [
                    {
                      label: "View inventory activity",
                      onSelect: () =>
                        router.push(
                          buildInventoryLedgerHref({
                            documentType: "purchase_order",
                            documentId: order.id,
                          })
                        ),
                    },
                  ]
                : []),
              ...(!isDeleted
                ? [
                    {
                      label: "Duplicate",
                      onSelect: () => duplicateMutation.mutate(),
                      disabled: duplicateMutation.isPending,
                    },
                  ]
                : []),
              ...(canSyncAccounting
                ? [
                    {
                      label: "Sync accounting",
                      onSelect: () => xeroPushMutation.mutate(),
                      disabled: xeroPushMutation.isPending,
                    },
                  ]
                : []),
              ...(canRetryXeroEmail
                ? [
                    {
                      label: "Retry PO email",
                      onSelect: () => xeroEmailMutation.mutate(),
                      disabled: xeroEmailMutation.isPending,
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
            {canSubmit ? (
              <Button
                size="sm"
                onClick={() => setSubmitConfirmOpen(true)}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
            ) : null}
            {canSyncAccounting ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => xeroPushMutation.mutate()}
                disabled={xeroPushMutation.isPending}
              >
                {xeroPushMutation.isPending ? "Syncing..." : "Sync accounting"}
              </Button>
            ) : null}
            {canReceive ? (
              <Button
                size="sm"
                onClick={() => setReceiveOpen(true)}
                disabled={receiveMutation.isPending}
              >
                Receive
              </Button>
            ) : null}
          </DetailPageActions>
        </div>

        <Separator />

        {order.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{order.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <AccountingSyncStatus
          document={accountingDocument}
          onRetryPush={canSyncAccounting ? () => xeroPushMutation.mutate() : undefined}
          retryPushPending={xeroPushMutation.isPending}
          onRetryEmail={canRetryXeroEmail ? () => xeroEmailMutation.mutate() : undefined}
          retryEmailPending={xeroEmailMutation.isPending}
          compact
        />

        {order.status === "draft" && order.xeroPurchaseOrderId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Imported from Xero</Badge>
            <span>{order.xeroPurchaseOrderNumber ?? order.xeroPurchaseOrderId}</span>
            {order.xeroPushedAt ? (
              <span>{formatDateTime(order.xeroPushedAt, timeZone)}</span>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Attachments</h2>
            {!isDeleted ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadFileMutation.isPending}
              >
                <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />
                Upload
              </Button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              handleFileInput(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          {!isDeleted ? (
            <div
              className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                handleFileInput(event.dataTransfer.files);
              }}
            >
              <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden />
              <button
                type="button"
                className="font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload or drop files
              </button>
            </div>
          ) : null}
          {fileActionError ? (
            <p className="text-sm text-destructive">{fileActionError}</p>
          ) : null}
          <div className="divide-y rounded-md border">
            {order.attachments.length > 0 ? (
              order.attachments.map((file) => (
                <div key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                  <FileTypeBadge file={file} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.sizeBytes)} {"\u00b7"} uploaded{" "}
                      {formatDateTime(file.createdAt, timeZone)}
                      {file.syncStatus === "synced" ? " \u00b7 synced" : ""}
                      {file.syncStatus === "failed" ? " \u00b7 sync failed" : ""}
                    </p>
                    {file.syncStatus === "failed" && file.syncError ? (
                      <p className="text-xs text-destructive">{file.syncError}</p>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a
                      href={`/api/purchase-orders/${order.id}/files/${file.id}`}
                      aria-label={`Download ${file.filename}`}
                    >
                      <HugeiconsIcon icon={Download01Icon} />
                    </a>
                  </Button>
                  {!isDeleted ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${file.filename}`}
                      onClick={() => deleteFileMutation.mutate(file.id)}
                      disabled={deleteFileMutation.isPending}
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No attachments.
              </div>
            )}
          </div>
        </div>

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Supplier</dt>
            <dd className="mt-1 text-sm">
              <Link
                href={`/purchasing/suppliers/${order.supplierId}`}
                className="hover:underline"
              >
                {order.supplierName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <PurchaseOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Expected Date" tooltip={EXPECTED_DELIVERY_DATE_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{formatDate(order.expectedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Total" tooltip={ORDER_TOTAL_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{formatPrice(order.totalAmount) ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              Additional Costs
            </dt>
            <dd className="mt-1 text-sm">
              {formatPrice(additionalCostTotal.toFixed(4)) ?? "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.createdAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.updatedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Ordered</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.orderedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Received</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.receivedAt, timeZone)}</dd>
          </div>
          {order.deletedAt && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Deleted</dt>
              <dd className="mt-1 text-sm">{formatDateTime(order.deletedAt, timeZone)}</dd>
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
                  <TableHead>Material</TableHead>
                  <TableHead>
                    <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Ordered" tooltip={PO_ORDERED_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Received" tooltip={PO_RECEIVED_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Remaining" tooltip={PO_REMAINING_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Unit Cost" tooltip={PURCHASE_UNIT_COST_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
                  </TableHead>
                  <TableHead>Delivery Address</TableHead>
                  <TableHead>Accounting Account</TableHead>
                  <TableHead className="text-right">Allocated Costs</TableHead>
                  <TableHead className="text-right">Landed Cost</TableHead>
                  <TableHead className="text-right">Landed / Stock Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Link
                        href={itemDetailHref("material", line.itemId)}
                        className="hover:underline"
                      >
                        {line.itemName}
                      </Link>
                    </TableCell>
                    <TableCell>{line.itemSku ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityOrdered)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityReceived)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityRemaining)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div>{line.purchaseUnitName}</div>
                        {line.purchaseUnitName !== line.stockingUnitName ? (
                          <QuantityWithUnit
                            value={line.stockQuantityOrdered}
                            unitName={line.stockingUnitName}
                            suffix="stocked"
                            className="text-xs"
                            muted
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.unitCost) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.lineTotal) ?? "\u2014"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span>
                          {formatAddressLines({
                            line1: line.shipLine1,
                            line2: line.shipLine2,
                            city: line.shipCity,
                            region: line.shipRegion,
                            postcode: line.shipPostcode,
                            country: line.shipCountry,
                          }).join(", ") || "\u2014"}
                        </span>
                        {[line.shipContactName, line.shipContactPhone]
                          .filter(Boolean)
                          .join(" · ") ? (
                          <span className="text-xs text-muted-foreground">
                            {[line.shipContactName, line.shipContactPhone]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                        {line.shipDeliveryInstructions ? (
                          <span className="text-xs text-muted-foreground">
                            {line.shipDeliveryInstructions}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      {line.accountingPurchaseAccountCode ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.allocatedAdditionalCost) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.landedCost) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.stockUnitCost) ?? "\u2014"} /{" "}
                      {line.stockingUnitName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Additional Costs</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Distribution</TableHead>
                  <TableHead>Accounting Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.additionalCosts.length > 0 ? (
                  order.additionalCosts.map((cost) => (
                    <TableRow key={cost.id}>
                      <TableCell>{ADDITIONAL_COST_TYPE_LABELS[cost.costType]}</TableCell>
                      <TableCell>{cost.reference ?? "\u2014"}</TableCell>
                      <TableCell>
                        {ADDITIONAL_COST_DISTRIBUTION_LABELS[cost.distributionMethod]}
                      </TableCell>
                      <TableCell className="font-mono">
                        {cost.accountingPurchaseAccountCode ?? "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(cost.amount) ?? "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                    >
                      No additional costs.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {syncDialog ? (
        <AccountingSyncDialog
          open
          title={syncDialog.title}
          description={syncDialog.description}
          stages={syncDialog.stages}
          error={syncDialog.error}
          warnings={syncDialog.warnings}
          isWorking={syncDialog.isWorking}
          documentNumber={syncDialog.documentNumber}
          documentId={syncDialog.documentId}
          documentIdLabel="Accounting document ID"
          onOpenChange={(open) => {
            if (!open) setSyncDialog(null);
          }}
          onDone={() => setSyncDialog(null)}
        />
      ) : null}

      <AccountingActionConfirmDialog
        open={submitConfirmOpen}
        title="Submit Purchase Order"
        description="Review what happens next."
        confirmLabel="Submit"
        pendingLabel="Submitting..."
        localStep={{
          title: "Submit PO",
          detail: order.orderNumber,
          meta: `${order.supplierName} · ${formatPrice(order.totalAmount) ?? "-"} · ${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"}`,
        }}
        accountingStep={{
          title: "Create in accounting",
          detail: "Purchase order",
          meta: "Manual sync",
        }}
        emailStep={{
          title: "Email supplier",
          detail: order.supplierEmail ?? "No supplier email",
          meta: order.supplierName,
        }}
        options={submitOptions}
        onOptionsChange={setSubmitOptions}
        onConfirm={() => submitMutation.mutate(submitOptions)}
        onOpenChange={setSubmitConfirmOpen}
        isPending={submitMutation.isPending}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this purchase order?</AlertDialogTitle>
            <AlertDialogDescription>
              Unreceived orders will be removed from normal views and any expected
              inventory will be released. Received orders cannot be deleted. This action
              cannot be undone.
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

	      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground">
          <DialogHeader>
            <DialogTitle>Receive Purchase Order</DialogTitle>
            <DialogDescription>
              Blank values are ignored; receipts create lots.
            </DialogDescription>
          </DialogHeader>

          <form
            id="receive-purchase-order-form"
            className="space-y-4"
            onSubmit={receiveForm.handleSubmit((values) => receiveMutation.mutate(values))}
          >
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Ordered" tooltip={PO_ORDERED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Received" tooltip={PO_RECEIVED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Remaining" tooltip={PO_REMAINING_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
                    </TableHead>
                    <TableHead className="w-44">
                      <TooltipHeader label="Disposition" tooltip={RECEIPT_DISPOSITION_TOOLTIP} />
                    </TableHead>
                    <TableHead className="w-44">
                      <TooltipHeader label="Receive Now" tooltip={PO_RECEIVE_NOW_TOOLTIP} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <Link
                          href={itemDetailHref("material", line.itemId)}
                          className="block space-y-1 hover:underline"
                        >
                          <div className="font-medium">{line.itemName}</div>
                          {line.itemSku && (
                            <p className="text-xs text-muted-foreground">{line.itemSku}</p>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityOrdered)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityReceived)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityRemaining)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div>{line.purchaseUnitName}</div>
                          {line.purchaseUnitName !== line.stockingUnitName ? (
                            <QuantityWithUnit
                              value={line.stockQuantityRemaining}
                              unitName={line.stockingUnitName}
                              suffix="remaining"
                              className="text-xs"
                              muted
                            />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Controller
                          control={receiveForm.control}
                          name={`lines.${index}.disposition`}
                          render={({ field, fieldState }) => (
                            <Select
                              value={field.value ?? "available"}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger aria-invalid={fieldState.invalid}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="available">Available</SelectItem>
                                  <SelectItem value="blocked">Blocked</SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Controller
                          control={receiveForm.control}
                          name={`lines.${index}.quantityReceived`}
                          render={({ field, fieldState }) => (
                            <div>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                onChange={(event) => field.onChange(event.target.value || null)}
                                aria-invalid={fieldState.invalid}
                                inputMode="decimal"
                                placeholder="0"
                                autoComplete="off"
                              />
                              {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                              )}
                            </div>
                          )}
                        />
                        <input
                          type="hidden"
                          value={line.id}
                          {...receiveForm.register(`lines.${index}.lineId`)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {receiveLinesError && <FieldError>{receiveLinesError}</FieldError>}
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiveOpen(false)}>
              Back
            </Button>
            <Button
              type="submit"
              form="receive-purchase-order-form"
              disabled={receiveMutation.isPending}
            >
              {receiveMutation.isPending ? "Receiving..." : "Receive Materials"}
            </Button>
          </DialogFooter>
        </DialogContent>
	      </Dialog>

	      <AlertDialog
	        open={overReceiptWarning != null}
	        onOpenChange={(open) => {
	          if (!open) setOverReceiptWarning(null);
	        }}
	      >
	        <AlertDialogContent className="bg-background text-foreground">
	          <AlertDialogHeader>
	            <AlertDialogTitle>Receive more than ordered?</AlertDialogTitle>
	            <AlertDialogDescription>
	              The ordered quantity will be increased to match this receipt.
	            </AlertDialogDescription>
	          </AlertDialogHeader>
	          <div className="space-y-2 text-sm">
	            {overReceiptWarning?.lines.map((line) => (
	              <div key={line.lineId} className="rounded-md border p-3">
	                <p className="font-medium">{line.itemName}</p>
	                <p className="text-muted-foreground">
	                  Receiving {formatQuantity(line.requested)} with{" "}
	                  {formatQuantity(line.remaining)} remaining.
	                </p>
	              </div>
	            ))}
	          </div>
	          <AlertDialogFooter>
	            <AlertDialogCancel>Back</AlertDialogCancel>
	            <AlertDialogAction
	              disabled={receiveMutation.isPending}
	              onClick={() =>
	                receiveMutation.mutate({
	                  ...receiveForm.getValues(),
	                  confirmOverReceipt: true,
	                })
	              }
	            >
	              {receiveMutation.isPending ? "Receiving..." : "Receive Anyway"}
	            </AlertDialogAction>
	          </AlertDialogFooter>
	        </AlertDialogContent>
	      </AlertDialog>
	    </>
	  );
	}
