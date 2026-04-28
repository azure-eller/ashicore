import { Badge } from "@/components/ui/badge";
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
  let badge;

  if (status === "ordered") {
    badge = <Badge>Ordered</Badge>;
  } else if (status === "partial") {
    badge = <Badge variant="outline">Partially Received</Badge>;
  } else if (status === "received") {
    badge = <Badge variant="outline">Received</Badge>;
  } else if (status === "cancelled") {
    badge = <Badge variant="destructive">Cancelled</Badge>;
  } else {
    badge = <Badge variant="secondary">Draft</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">
        {PURCHASE_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
