"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type OrderStatusControlConfig,
  type OrderStatusOption,
} from "@/components/card-page/order-status-control";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ManufacturingCompletionDialog } from "@/components/manufacturing/manufacturing-completion-dialog";
import {
  shipSalesOrder,
  SalesOrderApiError,
} from "@/lib/api/clients/sales-orders";
import { updatePurchaseOrderStatus } from "@/lib/api/clients/purchase-orders";
import { patchManufacturingOrder } from "@/lib/api/clients/manufacturing-orders";
import { deriveProductionStatus } from "@/lib/manufacturing/derive-status";
import { deriveOrderDisplayStatus } from "@/lib/sales/order-display-status";
import { formatQuantity } from "@/lib/format";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";
import type { ManufacturingPickProgressStatus } from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

export type SalesOrderStatusFields = SalesOrderListRow | SalesOrderDetail;
export type SalesOrderStatusContext = { order: SalesOrderStatusFields };

const SALES_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "NOT SHIPPED", label: "Not shipped", tone: "neutral" },
  { value: "PARTIALLY SHIPPED", label: "Partially shipped", tone: "warning" },
  { value: "SHIPPED", label: "Shipped", tone: "success" },
];

export const salesOrderStatusConfig: OrderStatusControlConfig<SalesOrderStatusContext> = {
  type: "sales",
  options: () => SALES_STATUS_OPTIONS,
  current: ({ order }) => deriveOrderDisplayStatus(order).label,
  transitionKind: (from, to) => {
    if (from === "SHIPPED") return "disabled";
    if (to === from) return "noop";
    if (to === "SHIPPED") return "dialog";
    return "disabled";
  },
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "SHIPPED") return null;
    return <ShipOrderDialog orderId={ctx.order.id} onClose={onClose} onDone={onDone} />;
  },
};

export function isSalesOrderStatusDisabled(order: SalesOrderStatusFields) {
  return deriveOrderDisplayStatus(order).label === "SHIPPED";
}

function NegativeStockNotice({ items }: { items: NegativeStockWarningPayload[] }) {
  return (
    <div className="space-y-2 border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3">
      <p className="text-sm font-medium text-[var(--color-warning)]">
        This will drive stock negative:
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item.itemId}>
            {item.itemName}: short {formatQuantity(String(item.shortage))} (need{" "}
            {formatQuantity(String(item.requested))}, have {formatQuantity(String(item.available))})
          </li>
        ))}
      </ul>
    </div>
  );
}

function useShipMutation(run: (confirmNegativeStock: boolean) => Promise<void>, onDone: () => void) {
  const [warning, setWarning] = useState<NegativeStockWarningPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (confirmNegativeStock: boolean) => run(confirmNegativeStock),
    onSuccess: () => onDone(),
    onError: (err) => {
      if (err instanceof SalesOrderApiError && err.status === 409 && err.negativeStock) {
        setWarning(err.negativeStock);
        setError(null);
        return;
      }
      setWarning(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    },
  });
  return { mutation, warning, error };
}

function ShipOrderDialog({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { mutation, warning, error } = useShipMutation(
    (confirm) => shipSalesOrder(orderId, confirm),
    onDone,
  );
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark order shipped?</DialogTitle>
          <DialogDescription>
            All remaining allocated quantity will be shipped and the order moves to its
            shipped state.
          </DialogDescription>
        </DialogHeader>
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate(warning != null)} disabled={mutation.isPending}>
            {mutation.isPending ? "Shipping..." : warning ? "Ship anyway" : "Mark shipped"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ManufacturingStatusFields = {
  id: string;
  status: ManufacturingOrderStatus;
  isBlocked: boolean;
  manufacturingMode: string;
  pickProgressStatus: ManufacturingPickProgressStatus;
  completedBatchCount: number;
  actualQuantity?: string | null;
};

export type ManufacturingStatusContext = { order: ManufacturingStatusFields };

const MANUFACTURING_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "not_started", label: "Not started", tone: "neutral" },
  { value: "blocked", label: "Blocked", tone: "danger" },
  { value: "in_progress", label: "Work in progress", tone: "warning" },
  { value: "partially_complete", label: "Partially complete", tone: "warning" },
  { value: "done", label: "Done", tone: "success" },
];

export const manufacturingOrderStatusConfig: OrderStatusControlConfig<ManufacturingStatusContext> = {
  type: "manufacturing",
  options: () => MANUFACTURING_STATUS_OPTIONS,
  current: ({ order }) =>
    deriveProductionStatus({
      status: order.status,
      isBlocked: order.isBlocked,
      pickProgressStatus: order.pickProgressStatus,
      completedBatchCount: order.completedBatchCount,
    }),
  transitionKind: (from, to, { order }) => {
    if (from === "done") return "disabled";
    if (to === from) return "noop";
    if (to === "partially_complete" && order.manufacturingMode !== "batch") {
      return "disabled";
    }
    if (to === "partially_complete" || to === "done") return "dialog";
    return "instant";
  },
  runInstant: (to, { order }) =>
    patchManufacturingOrder(order.id, { isBlocked: to === "blocked" }).then(() => undefined),
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "done" && to !== "partially_complete") return null;
    return (
      <ManufacturingCompletionDialog
        orderId={ctx.order.id}
        mode={to === "done" ? "complete" : "output"}
        onClose={onClose}
        onDone={onDone}
      />
    );
  },
};

export function isManufacturingStatusDisabled(
  order: Pick<ManufacturingStatusFields, "status">
) {
  return order.status === "done";
}

export type PurchaseStatusContext = {
  orderId: string;
  status: PurchaseOrderStatus;
};

const PURCHASE_STATUS_OPTIONS: OrderStatusOption[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "ordered", label: "Ordered", tone: "info" },
  { value: "partial", label: "Partially received", tone: "warning" },
  { value: "received", label: "Received", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
];

function canPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus) {
  if (from === "draft") return to === "ordered";
  if (from === "ordered") return to === "received";
  if (from === "partial") return to === "received";
  return false;
}

export const purchaseOrderStatusConfig: OrderStatusControlConfig<PurchaseStatusContext> = {
  type: "purchase",
  options: () => PURCHASE_STATUS_OPTIONS,
  current: ({ status }) => status,
  transitionKind: (from, to) => {
    if (to === from) return "noop";
    if (!canPurchaseOrderTransition(from as PurchaseOrderStatus, to as PurchaseOrderStatus)) {
      return "disabled";
    }
    return to === "received" ? "dialog" : "instant";
  },
  runInstant: (to, { orderId }) =>
    updatePurchaseOrderStatus(orderId, to as PurchaseOrderStatus).then(() => undefined),
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "received") return null;
    return <ReceiveConfirmDialog orderId={ctx.orderId} onClose={onClose} onDone={onDone} />;
  },
};

function ReceiveConfirmDialog({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => updatePurchaseOrderStatus(orderId, "received"),
    onSuccess: () => onDone(),
  });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as received?</DialogTitle>
          <DialogDescription>
            All remaining lines will be committed to inventory at their listed receiving
            locations.
          </DialogDescription>
        </DialogHeader>
        {mutation.isError ? (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to receive."}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Receiving..." : "Mark received"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
