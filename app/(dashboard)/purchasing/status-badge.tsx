import { StatusLabel } from "@/components/ui/status-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PURCHASE_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

export function PurchaseOrderStatusBadge({
  status,
}: {
  status: PurchaseOrderStatus;
}) {
  let label;

  if (status === "ordered") {
    label = <StatusLabel tone="info">Ordered</StatusLabel>;
  } else if (status === "partial") {
    label = <StatusLabel tone="warning">Partially Received</StatusLabel>;
  } else if (status === "received") {
    label = <StatusLabel tone="success">Received</StatusLabel>;
  } else if (status === "cancelled") {
    label = <StatusLabel tone="danger">Cancelled</StatusLabel>;
  } else {
    label = <StatusLabel tone="neutral">Draft</StatusLabel>;
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
