"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  OrderStatusControl,
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
import {
  shipSalesOrder,
  shipSalesShipment,
  SalesOrderApiError,
} from "@/lib/api/clients/sales-orders";
import { deriveOrderDisplayStatus } from "@/lib/sales/order-display-status";
import { formatDate, formatQuantity } from "@/lib/format";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";

type SalesOrderForStatus = SalesOrderListRow | SalesOrderDetail;
type Ctx = { order: SalesOrderForStatus };

type ShipmentLike = {
  id: string;
  shipmentNumber: string;
  status: "planned" | "shipped";
  scheduledDate: string | null;
  fulfillmentType: "delivery" | "pickup";
};

const OPTIONS: OrderStatusOption[] = [
  { value: "OPEN", label: "Open", tone: "info" },
  { value: "ALLOCATED", label: "Allocated", tone: "success" },
  { value: "PARTIALLY SHIPPED", label: "Partially shipped", tone: "warning" },
  { value: "SHIPPED", label: "Shipped", tone: "success" },
  { value: "CLOSED", label: "Closed", tone: "neutral" },
];

function plannedShipments(order: SalesOrderForStatus): ShipmentLike[] {
  return (order.shipments as ShipmentLike[]).filter(
    (shipment) => shipment.status === "planned",
  );
}

const config: OrderStatusControlConfig<Ctx> = {
  type: "sales",
  options: () => OPTIONS,
  current: ({ order }) => deriveOrderDisplayStatus(order).label,
  transitionKind: (from, to, { order }) => {
    if (from === "SHIPPED" || from === "CLOSED") return "disabled";
    if (to === from) return "noop";
    if (to === "SHIPPED") return "dialog";
    if (to === "PARTIALLY SHIPPED") {
      // Only meaningful when there's more than one shipment to ship selectively.
      return order.shipments.length > 1 && plannedShipments(order).length > 0
        ? "dialog"
        : "disabled";
    }
    // OPEN / ALLOCATED are derived from allocation, not user-selectable.
    return "disabled";
  },
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to === "SHIPPED") {
      return <ShipOrderDialog orderId={ctx.order.id} onClose={onClose} onDone={onDone} />;
    }
    if (to === "PARTIALLY SHIPPED") {
      return (
        <PartialShipDialog
          orderId={ctx.order.id}
          shipments={plannedShipments(ctx.order)}
          onClose={onClose}
          onDone={onDone}
        />
      );
    }
    return null;
  },
};

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
            {mutation.isPending ? "Shipping…" : warning ? "Ship anyway" : "Mark shipped"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartialShipDialog({
  orderId,
  shipments,
  onClose,
  onDone,
}: {
  orderId: string;
  shipments: ShipmentLike[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const { mutation, warning, error } = useShipMutation(
    (confirm) => shipSalesShipment(orderId, target as string, confirm),
    onDone,
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ship which shipment?</DialogTitle>
          <DialogDescription>Mark a planned shipment as shipped.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          {shipments.map((shipment) => {
            const active = target === shipment.id;
            return (
              <button
                key={shipment.id}
                type="button"
                onClick={() => setTarget(shipment.id)}
                className={
                  "flex w-full items-center justify-between border px-3 py-2 text-left text-sm " +
                  (active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)] hover:bg-[var(--color-surface-alt)]")
                }
              >
                <span>{shipment.shipmentNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {shipment.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                  {shipment.scheduledDate ? ` · ${formatDate(shipment.scheduledDate)}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {warning ? <NegativeStockNotice items={[warning]} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(warning != null)}
            disabled={mutation.isPending || target == null}
          >
            {mutation.isPending ? "Shipping…" : warning ? "Ship anyway" : "Mark shipped"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SalesStatusControl({
  order,
  size = "md",
  onChanged,
}: {
  order: SalesOrderForStatus;
  size?: "sm" | "md";
  onChanged?: () => void;
}) {
  const current = deriveOrderDisplayStatus(order).label;
  return (
    <OrderStatusControl
      config={config}
      ctx={{ order }}
      size={size}
      disabled={current === "SHIPPED" || current === "CLOSED"}
      onChanged={onChanged}
    />
  );
}
