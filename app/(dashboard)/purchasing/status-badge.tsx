"use client";

import { StatusLabel } from "@/components/ui/status-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  draft: "Draft",
  ordered: "Ordered",
  partial: "Partially Received",
  received: "Received",
  cancelled: "Cancelled",
};

const statusOrder: PurchaseOrderStatus[] = [
  "draft",
  "ordered",
  "partial",
  "received",
  "cancelled",
];

function canTransitionStatus(
  current: PurchaseOrderStatus,
  next: PurchaseOrderStatus,
) {
  if (current === next) return true;
  if (current === "draft") return next === "ordered" || next === "cancelled";
  if (current === "ordered") return next === "received" || next === "cancelled";
  if (current === "partial") return next === "received";
  return false;
}

function statusLabel(status: PurchaseOrderStatus) {
  if (status === "ordered") {
    return <StatusLabel tone="info">Ordered</StatusLabel>;
  }
  if (status === "partial") {
    return <StatusLabel tone="warning">Partially Received</StatusLabel>;
  }
  if (status === "received") {
    return <StatusLabel tone="success">Received</StatusLabel>;
  }
  if (status === "cancelled") {
    return <StatusLabel tone="danger">Cancelled</StatusLabel>;
  }
  return <StatusLabel tone="neutral">Draft</StatusLabel>;
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
  const label = statusLabel(status);

  if (onStatusChange) {
    return (
      <Select
        value={status}
        disabled={disabled}
        onValueChange={(nextStatus) => {
          if (canTransitionStatus(status, nextStatus as PurchaseOrderStatus)) {
            onStatusChange(nextStatus as PurchaseOrderStatus);
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className={cn("w-full min-w-32 bg-background", className)}
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top">
        {PURCHASE_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
