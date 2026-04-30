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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MANUFACTURABLE_LINES_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  OVERSELL_TOOLTIP_COPY,
  REQUESTED_DATE_TOOLTIP,
  SALES_ADDED_QTY_TOOLTIP,
  ACTUAL_MARGIN_TOOLTIP,
  ESTIMATED_MARGIN_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  LINE_COGS_TOOLTIP,
  UNIT_TOOLTIP,
  ORDER_TOTAL_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatDateTime, formatPrice, formatQuantity } from "@/lib/format";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import {
  SALES_SHIPMENT_COST_STATUSES,
  SALES_SHIPMENT_COST_TYPES,
  type SalesShipmentCostStatus,
  type SalesShipmentCostType,
} from "@/lib/schemas/sales-orders";
import { ManufacturingOrderStatusBadge } from "@/app/(dashboard)/manufacturing/status-badge";
import { SalesOrderStatusBadge } from "./status-badge";
import type {
  OversellWarningPayload,
  SalesOrderDetail as SalesOrderDetailType,
  SalesMarginSummary,
  SalesShipmentRow,
} from "./types";

type ActionError = {
  status?: number;
  error?: string;
  oversell?: OversellWarningPayload;
};

function formatMarginPercent(value: string | null | undefined) {
  return value == null ? "\u2014" : `${value}%`;
}

function getShipToLines(order: SalesOrderDetailType) {
  return [
    order.shipLine1,
    order.shipLine2,
    [order.shipCity, order.shipRegion, order.shipPostcode]
      .filter(Boolean)
      .join(", "),
    order.shipCountry,
  ].filter((line): line is string => Boolean(line));
}

function ShipToAddress({ order }: { order: SalesOrderDetailType }) {
  const lines = getShipToLines(order);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="font-medium">Ship to</div>
      {lines.length > 0 ? (
        <div className="text-muted-foreground">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground">
          No ship-to address is saved on this order.
        </div>
      )}
    </div>
  );
}

type ShipmentFormState = {
  shipmentId: string | null;
  idempotencyKey: string;
  fulfillmentType: "delivery" | "pickup";
  scheduledDate: string;
  notes: string;
  quantities: Record<string, string>;
};

type ShipmentActionPayload = {
  shipmentId: string;
  idempotencyKey: string;
};

type ShipmentCostFormLine = {
  costType: SalesShipmentCostType;
  costStatus: SalesShipmentCostStatus;
  amount: string;
  vendorName: string;
  referenceNumber: string;
  incurredDate: string;
  notes: string;
};

type ShipmentCostFormState = {
  shipmentId: string;
  customerFreightChargeAmount: string;
  costs: ShipmentCostFormLine[];
};

const COST_TYPE_LABELS: Record<SalesShipmentCostType, string> = {
  freight: "Freight",
  delivery_labor: "Delivery labor",
  fuel: "Fuel",
  packaging: "Packaging",
  accessorial: "Accessorial",
  other: "Other",
};

const COST_STATUS_LABELS: Record<SalesShipmentCostStatus, string> = {
  estimated: "Estimated",
  actual: "Actual",
};

function marginStatusLabel(status: SalesMarginSummary["costStatus"]) {
  if (status === "actual") return "Actual";
  if (status === "estimated") return "Estimated";
  if (status === "mixed") return "Mixed";
  return "Unknown";
}

function emptyShipmentCostLine(): ShipmentCostFormLine {
  return {
    costType: "freight",
    costStatus: "estimated",
    amount: "",
    vendorName: "",
    referenceNumber: "",
    incurredDate: "",
    notes: "",
  };
}

function buildShipmentFormState(
  order: SalesOrderDetailType,
  shipment?: SalesShipmentRow
): ShipmentFormState {
  const quantities: Record<string, string> = {};
  order.lines.forEach((line) => {
    quantities[line.id] = shipment
      ? (shipment.lines.find((shipmentLine) => shipmentLine.salesOrderLineId === line.id)
          ?.quantity ?? "")
      : line.unplannedRemainingQuantity;
  });

  return {
    shipmentId: shipment?.id ?? null,
    idempotencyKey: `sales-shipment-${shipment ? "update" : "create"}:${crypto.randomUUID()}`,
    fulfillmentType: shipment?.fulfillmentType ?? "delivery",
    scheduledDate: shipment?.scheduledDate ?? "",
    notes: shipment?.notes ?? "",
    quantities,
  };
}

function buildShipmentCostFormState(shipment: SalesShipmentRow): ShipmentCostFormState {
  return {
    shipmentId: shipment.id,
    customerFreightChargeAmount: shipment.customerFreightChargeAmount ?? "",
    costs:
      shipment.costs.length > 0
        ? shipment.costs.map((cost) => ({
            costType: cost.costType,
            costStatus: cost.costStatus,
            amount: cost.amount,
            vendorName: cost.vendorName ?? "",
            referenceNumber: cost.referenceNumber ?? "",
            incurredDate: cost.incurredDate ?? "",
            notes: cost.notes ?? "",
          }))
        : [emptyShipmentCostLine()],
  };
}

function shipmentPayloadFromState(state: ShipmentFormState) {
  return {
    fulfillmentType: state.fulfillmentType,
    scheduledDate: state.scheduledDate || null,
    notes: state.notes || null,
    lines: Object.entries(state.quantities).flatMap(([salesOrderLineId, quantity]) => {
      const trimmedQuantity = quantity.trim();
      if (!trimmedQuantity) return [];

      const parsedQuantity = Number(trimmedQuantity);
      if (Number.isFinite(parsedQuantity) && parsedQuantity <= 0) return [];

      return [{ salesOrderLineId, quantity: trimmedQuantity }];
    }),
  };
}

function shipmentCostsPayloadFromState(state: ShipmentCostFormState) {
  return {
    customerFreightChargeAmount:
      state.customerFreightChargeAmount.trim() === ""
        ? null
        : state.customerFreightChargeAmount.trim(),
    costs: state.costs
      .filter((cost) => cost.amount.trim() !== "")
      .map((cost) => ({
        costType: cost.costType,
        costStatus: cost.costStatus,
        amount: cost.amount.trim(),
        vendorName: cost.vendorName.trim() || null,
        referenceNumber: cost.referenceNumber.trim() || null,
        incurredDate: cost.incurredDate || null,
        notes: cost.notes.trim() || null,
      })),
  };
}

function hasPositiveQuantity(state: ShipmentFormState | null) {
  if (!state) return false;
  return Object.values(state.quantities).some((value) => Number(value) > 0);
}

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
  const [cancelRemainingOpen, setCancelRemainingOpen] = useState(false);
  const [cancelRemainingIdempotencyKey, setCancelRemainingIdempotencyKey] =
    useState<string | null>(null);
  const [shipmentForm, setShipmentForm] = useState<ShipmentFormState | null>(null);
  const [shipmentCostForm, setShipmentCostForm] =
    useState<ShipmentCostFormState | null>(null);
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
    try {
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
    } catch {
      failSyncDialog({
        title,
        description,
        localActionLabel,
        message: "Failed to reload order status.",
      });
    }
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

  const shipmentMutation = useMutation({
    mutationFn: async (values: ShipmentFormState) => {
      const isEdit = values.shipmentId != null;
      const response = await fetch(
        isEdit
          ? `/api/sales-orders/${order.id}/shipments/${values.shipmentId}`
          : `/api/sales-orders/${order.id}/shipments`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": values.idempotencyKey,
          },
          body: JSON.stringify(shipmentPayloadFromState(values)),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save shipment.");
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
      setShipmentForm(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const shipmentCostMutation = useMutation({
    mutationFn: async (values: ShipmentCostFormState) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${values.shipmentId}/costs`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(shipmentCostsPayloadFromState(values)),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save shipment costs.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      setShipmentCostForm(null);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelShipmentMutation = useMutation({
    mutationFn: async ({ shipmentId, idempotencyKey }: ShipmentActionPayload) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipmentId}`,
        {
          method: "DELETE",
          headers: { "Idempotency-Key": idempotencyKey },
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel shipment.");
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
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const shipShipmentMutation = useMutation({
    mutationFn: async ({ shipmentId, idempotencyKey }: ShipmentActionPayload) => {
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipmentId}/ship`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ syncAccounting: true, sendEmail: false }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to ship shipment.");
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
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelRemainingMutation = useMutation({
    mutationFn: async () => {
      if (!cancelRemainingIdempotencyKey) {
        throw new Error("Open cancel remaining before confirming.");
      }

      const response = await fetch(`/api/sales-orders/${order.id}/cancel-remaining`, {
        method: "POST",
        headers: { "Idempotency-Key": cancelRemainingIdempotencyKey },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel remaining quantities.");
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
      setCancelRemainingOpen(false);
      setCancelRemainingIdempotencyKey(null);
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
  const canCreateShipment =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped") &&
    order.lines.some((line) => Number(line.unplannedRemainingQuantity) > 0);
  const canCancelRemaining =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped") &&
    order.lines.some((line) => Number(line.remainingQuantity) > 0);
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
  const canCreateMOs =
    !isDeleted &&
    (order.status === "confirmed" || order.status === "partially_shipped");
  const createMOHref = `/manufacturing/orders/new?salesOrderId=${order.id}`;
  const showShippingSection =
    order.status === "confirmed" ||
    order.status === "partially_shipped" ||
    order.status === "shipped" ||
    order.shipments.length > 0;
  const hasCancelledRemainingHistory =
    order.status === "cancelled" &&
    order.shipments.some((shipment) => shipment.status === "shipped");

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
            {canCreateShipment ? (
              <Button size="sm" onClick={() => setShipmentForm(buildShipmentFormState(order))}>
                Create Shipment
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

        {showShippingSection && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Shipping</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    order.shippingReadiness.state === "ready"
                      ? "default"
                      : order.shippingReadiness.state === "shipped"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {order.shippingReadiness.message}
                </Badge>
                {canCancelRemaining ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCancelRemainingIdempotencyKey(
                        `sales-order-cancel-remaining:${crypto.randomUUID()}`
                      );
                      setCancelRemainingOpen(true);
                    }}
                  >
                    Cancel Remaining
                  </Button>
                ) : null}
              </div>
            </div>
            {hasCancelledRemainingHistory ? (
              <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                This order shipped partially; remaining quantities were cancelled.
              </div>
            ) : null}
            {order.shippingReadiness.blockers.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {order.shippingReadiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            <ShipToAddress order={order} />
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shipment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Ship Cost</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.shipments.length > 0 ? (
                    order.shipments.map((shipment) => (
                      <TableRow key={shipment.id}>
                        <TableCell>{shipment.shipmentNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              shipment.status === "shipped"
                                ? "outline"
                                : shipment.status === "cancelled"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {shipment.status === "shipped"
                              ? "Shipped"
                              : shipment.status === "cancelled"
                                ? "Cancelled"
                                : "Draft"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {shipment.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                        </TableCell>
                        <TableCell>{formatDate(shipment.scheduledDate)}</TableCell>
                        <TableCell>
                          {shipment.lines
                            .map(
                              (line) =>
                                `${formatQuantity(line.quantity)} ${line.unitName} ${line.itemName}`
                            )
                            .join(", ")}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPrice(shipment.marginSummary.productRevenue) ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div>
                            {formatPrice(shipment.marginSummary.productCogs) ?? "\u2014"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {marginStatusLabel(shipment.marginSummary.costStatus)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPrice(shipment.marginSummary.shipmentCosts) ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div>
                            {formatPrice(shipment.marginSummary.contributionMargin) ??
                              "\u2014"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatMarginPercent(shipment.marginSummary.marginPercent)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {shipment.status !== "cancelled" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  window.open(
                                    `/api/sales-orders/${order.id}/shipments/${shipment.id}/bol`,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                                }}
                              >
                                BOL
                              </Button>
                            ) : null}
                            {shipment.status !== "cancelled" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setShipmentCostForm(
                                    buildShipmentCostFormState(shipment)
                                  )
                                }
                              >
                                Costs
                              </Button>
                            ) : null}
                            {shipment.status === "draft" ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setShipmentForm(buildShipmentFormState(order, shipment))
                                  }
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    shipShipmentMutation.mutate({
                                      shipmentId: shipment.id,
                                      idempotencyKey: `sales-shipment-ship:${crypto.randomUUID()}`,
                                    })
                                  }
                                  disabled={shipShipmentMutation.isPending}
                                >
                                  Ship
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    cancelShipmentMutation.mutate({
                                      shipmentId: shipment.id,
                                      idempotencyKey: `sales-shipment-cancel:${crypto.randomUUID()}`,
                                    })
                                  }
                                  disabled={cancelShipmentMutation.isPending}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} className="text-muted-foreground">
                        No shipments have been planned.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

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

        {order.shipments.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Order Margin</h2>
              <Badge variant="secondary">
                {marginStatusLabel(order.marginSummary.costStatus)}
              </Badge>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell>Product revenue</TableCell>
                    <TableCell className="text-right">
                      {formatPrice(order.marginSummary.productRevenue) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Freight recovered</TableCell>
                    <TableCell className="text-right">
                      {formatPrice(order.marginSummary.freightRecovery) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Product COGS</TableCell>
                    <TableCell className="text-right">
                      {formatPrice(order.marginSummary.productCogs) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Shipment costs</TableCell>
                    <TableCell className="text-right">
                      {formatPrice(order.marginSummary.shipmentCosts) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Contribution margin</TableCell>
                    <TableCell className="text-right">
                      <div>
                        {formatPrice(order.marginSummary.contributionMargin) ?? "\u2014"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMarginPercent(order.marginSummary.marginPercent)}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

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
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Requested Date" tooltip={REQUESTED_DATE_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{formatDate(order.requestedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader
                label="Manufacturable Lines"
                tooltip={MANUFACTURABLE_LINES_TOOLTIP}
              />
            </dt>
            <dd className="mt-1 text-sm">{order.manufacturableLineCount}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Total" tooltip={ORDER_TOTAL_TOOLTIP} />
            </dt>
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
                  <TableHead>
                    <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Shipped</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>
                    <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Unit Price" tooltip={SALES_UNIT_PRICE_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader
                      label="COGS"
                      tooltip={LINE_COGS_TOOLTIP}
                    />
                  </TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader
                      label={order.status === "shipped" ? "Actual Margin" : "Est. Margin"}
                      tooltip={
                        order.status === "shipped"
                          ? ACTUAL_MARGIN_TOOLTIP
                          : ESTIMATED_MARGIN_TOOLTIP
                      }
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => {
                  const hasActualMargin = line.actualCogs != null;
                  const cogs = hasActualMargin ? line.actualCogs : line.estimatedCogs;
                  const grossProfit = hasActualMargin
                    ? line.actualGrossProfit
                    : line.estimatedGrossProfit;
                  const marginPercent = hasActualMargin
                    ? line.actualMarginPercent
                    : line.estimatedMarginPercent;

                  return (
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
                      <TableCell className="text-right">{line.plannedQuantity}</TableCell>
                      <TableCell className="text-right">{line.shippedQuantity}</TableCell>
                      <TableCell className="text-right">{line.remainingQuantity}</TableCell>
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
                      <TableCell className="text-right">
                        {formatPrice(cogs) ?? "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(grossProfit) ?? "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-medium">
                          {formatMarginPercent(marginPercent)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {hasActualMargin ? "Actual" : "Estimated"}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
                    <TableHead className="text-right">
                      <TooltipHeader label="Qty" tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />
                    </TableHead>
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

      <Dialog
        open={shipmentForm != null}
        onOpenChange={(open) => {
          if (!open) setShipmentForm(null);
        }}
      >
        <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {shipmentForm?.shipmentId ? "Edit Shipment" : "Create Shipment"}
            </DialogTitle>
            <DialogDescription>
              Planned shipments can produce a Draft BOL before stock leaves.
            </DialogDescription>
          </DialogHeader>
          {shipmentForm ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                shipmentMutation.mutate(shipmentForm);
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Select
                    value={shipmentForm.fulfillmentType}
                    onValueChange={(value) =>
                      setShipmentForm({
                        ...shipmentForm,
                        fulfillmentType: value as "delivery" | "pickup",
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="pickup">Pickup</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Scheduled Date</label>
                  <DatePicker
                    value={shipmentForm.scheduledDate}
                    onChange={(value) =>
                      setShipmentForm({ ...shipmentForm, scheduledDate: value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  value={shipmentForm.notes}
                  onChange={(event) =>
                    setShipmentForm({ ...shipmentForm, notes: event.target.value })
                  }
                  rows={3}
                />
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Planned</TableHead>
                      <TableHead className="text-right">Shipped</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="w-36 text-right">This Shipment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div>{line.itemName}</div>
                          {line.itemSku ? (
                            <div className="text-xs text-muted-foreground">
                              {line.itemSku}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">{line.quantity}</TableCell>
                        <TableCell className="text-right">{line.plannedQuantity}</TableCell>
                        <TableCell className="text-right">{line.shippedQuantity}</TableCell>
                        <TableCell className="text-right">
                          {line.unplannedRemainingQuantity} {line.unitName}
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Shipment quantity for ${line.itemName}`}
                            inputMode="decimal"
                            value={shipmentForm.quantities[line.id] ?? ""}
                            onChange={(event) =>
                              setShipmentForm({
                                ...shipmentForm,
                                quantities: {
                                  ...shipmentForm.quantities,
                                  [line.id]: event.target.value,
                                },
                              })
                            }
                            className="text-right"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShipmentForm(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={shipmentMutation.isPending || !hasPositiveQuantity(shipmentForm)}
                >
                  {shipmentMutation.isPending ? "Saving..." : "Save Shipment"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={shipmentCostForm != null}
        onOpenChange={(open) => {
          if (!open) setShipmentCostForm(null);
        }}
      >
        <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Costs & Margin</DialogTitle>
            <DialogDescription>
              Customer freight recovery is for margin tracking only. Not added to Xero
              invoices.
            </DialogDescription>
          </DialogHeader>
          {shipmentCostForm ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                shipmentCostMutation.mutate(shipmentCostForm);
              }}
            >
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="customer-freight-recovery">
                  Customer freight recovery
                </label>
                <Input
                  id="customer-freight-recovery"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={shipmentCostForm.customerFreightChargeAmount}
                  onChange={(event) =>
                    setShipmentCostForm({
                      ...shipmentCostForm,
                      customerFreightChargeAmount: event.target.value,
                    })
                  }
                />
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Incurred</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipmentCostForm.costs.map((cost, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select
                            value={cost.costType}
                            onValueChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        costType: value as SalesShipmentCostType,
                                      }
                                    : entry
                                ),
                              })
                            }
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SALES_SHIPMENT_COST_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {COST_TYPE_LABELS[type]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={cost.costStatus}
                            onValueChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        costStatus: value as SalesShipmentCostStatus,
                                      }
                                    : entry
                                ),
                              })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SALES_SHIPMENT_COST_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {COST_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost amount"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={cost.amount}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, amount: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-28 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost vendor"
                            value={cost.vendorName}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, vendorName: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-40"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost reference"
                            value={cost.referenceNumber}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, referenceNumber: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-36"
                          />
                        </TableCell>
                        <TableCell>
                          <DatePicker
                            value={cost.incurredDate}
                            onChange={(value) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, incurredDate: value }
                                    : entry
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label="Shipment cost notes"
                            value={cost.notes}
                            onChange={(event) =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs: shipmentCostForm.costs.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, notes: event.target.value }
                                    : entry
                                ),
                              })
                            }
                            className="w-48"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setShipmentCostForm({
                                ...shipmentCostForm,
                                costs:
                                  shipmentCostForm.costs.length === 1
                                    ? [emptyShipmentCostLine()]
                                    : shipmentCostForm.costs.filter(
                                        (_entry, entryIndex) => entryIndex !== index
                                      ),
                              })
                            }
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setShipmentCostForm({
                      ...shipmentCostForm,
                      costs: [...shipmentCostForm.costs, emptyShipmentCostLine()],
                    })
                  }
                >
                  Add Cost
                </Button>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShipmentCostForm(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={shipmentCostMutation.isPending}>
                    {shipmentCostMutation.isPending ? "Saving..." : "Save Costs"}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

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

      <AlertDialog
        open={cancelRemainingOpen}
        onOpenChange={(open) => {
          setCancelRemainingOpen(open);
          if (!open) {
            setCancelRemainingIdempotencyKey(null);
          } else if (!cancelRemainingIdempotencyKey) {
            setCancelRemainingIdempotencyKey(
              `sales-order-cancel-remaining:${crypto.randomUUID()}`
            );
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel remaining quantities?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft shipments will be cancelled and unshipped reservations released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelRemainingMutation.isPending}
              onClick={() => cancelRemainingMutation.mutate()}
            >
              {cancelRemainingMutation.isPending ? "Cancelling..." : "Cancel Remaining"}
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
