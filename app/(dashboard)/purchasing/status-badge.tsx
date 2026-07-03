"use client";

import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PURCHASE_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";
import { cn } from "@/lib/utils";

const statusLabels: Record<PurchaseOrderStatus, string> = {
  not_received: "Not received",
  partial: "Partially Received",
  received: "Received",
};

const statusOrder: PurchaseOrderStatus[] = [
  "not_received",
  "partial",
  "received",
];

const purchaseOrderStatusConfig = {
  not_received: {
    label: statusLabels.not_received,
    tone: "info",
    tooltip: PURCHASE_ORDER_STATUS_TOOLTIP.not_received,
  },
  partial: {
    label: statusLabels.partial,
    tone: "warning",
    tooltip: PURCHASE_ORDER_STATUS_TOOLTIP.partial,
  },
  received: {
    label: statusLabels.received,
    tone: "success",
    tooltip: PURCHASE_ORDER_STATUS_TOOLTIP.received,
  },
} satisfies StatusBadgeConfig<PurchaseOrderStatus>;

function canTransitionStatus(
  current: PurchaseOrderStatus,
  next: PurchaseOrderStatus,
) {
  if (current === next) return true;
  if (current === "not_received") return next === "received";
  if (current === "partial") return next === "received";
  return false;
}

function confirmStatusTransition(next: PurchaseOrderStatus) {
  if (next === "received") {
    return window.confirm(
      "Mark this PO as Received? Lines will be committed to inventory at the listed receiving locations.",
    );
  }
  return true;
}

export function PurchaseOrderStatusBadge({
  status,
  onStatusChange,
  disabled = false,
  className,
}: {
  status: PurchaseOrderStatus;
  onStatusChange?: (status: PurchaseOrderStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const label = (
    <StatusBadge
      status={status}
      config={purchaseOrderStatusConfig}
      tooltip={false}
    />
  );

  if (onStatusChange) {
    return (
      <Select
        value={status}
        disabled={disabled}
        onValueChange={(nextStatus) => {
          const nextPurchaseOrderStatus = nextStatus as PurchaseOrderStatus;
          if (
            canTransitionStatus(status, nextPurchaseOrderStatus) &&
            confirmStatusTransition(nextPurchaseOrderStatus)
          ) {
            onStatusChange(nextPurchaseOrderStatus);
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className={cn("w-full min-w-32 bg-[var(--color-bg)]", className)}
          aria-label="Change purchase order status"
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="end"
          className="min-w-36"
          onClick={(event) => event.stopPropagation()}
        >
          {statusOrder.map((nextStatus) => {
            const canSelect = canTransitionStatus(status, nextStatus);
            return (
              <SelectItem
                key={nextStatus}
                value={nextStatus}
                disabled={!canSelect || nextStatus === status}
              >
                {statusLabels[nextStatus]}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  return <StatusBadge status={status} config={purchaseOrderStatusConfig} />;
}
