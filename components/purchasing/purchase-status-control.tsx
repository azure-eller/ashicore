"use client";

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
import { updatePurchaseOrderStatus } from "@/lib/api/clients/purchase-orders";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

type Ctx = { orderId: string; status: PurchaseOrderStatus };

const OPTIONS: OrderStatusOption[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "ordered", label: "Ordered", tone: "info" },
  { value: "partial", label: "Partially received", tone: "warning" },
  { value: "received", label: "Received", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
];

function canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus) {
  if (from === "draft") return to === "ordered";
  if (from === "ordered") return to === "received";
  if (from === "partial") return to === "received";
  return false;
}

const config: OrderStatusControlConfig<Ctx> = {
  type: "purchase",
  options: () => OPTIONS,
  current: ({ status }) => status,
  transitionKind: (from, to) => {
    if (to === from) return "noop";
    if (!canTransition(from as PurchaseOrderStatus, to as PurchaseOrderStatus)) {
      return "disabled";
    }
    // Receiving commits lines to inventory — confirm first. Ordering is instant.
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
            {mutation.isPending ? "Receiving…" : "Mark received"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PurchaseStatusControl({
  orderId,
  status,
  disabled,
  onChanged,
  size = "md",
}: {
  orderId: string;
  status: PurchaseOrderStatus;
  disabled?: boolean;
  onChanged?: () => void;
  size?: "sm" | "md";
}) {
  return (
    <OrderStatusControl
      config={config}
      ctx={{ orderId, status }}
      size={size}
      disabled={disabled}
      onChanged={onChanged}
    />
  );
}
