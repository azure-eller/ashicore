import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MANUFACTURING_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

export function ManufacturingOrderStatusBadge({
  status,
}: {
  status: ManufacturingOrderStatus;
}) {
  let badge;

  if (status === "released") {
    badge = <Badge>Released</Badge>;
  } else if (status === "completed") {
    badge = <Badge variant="outline">Completed</Badge>;
  } else if (status === "cancelled") {
    badge = <Badge variant="destructive">Cancelled</Badge>;
  } else {
    badge = <Badge variant="secondary">Draft</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">
        {MANUFACTURING_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
