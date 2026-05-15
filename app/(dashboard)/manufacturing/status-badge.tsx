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
  const badge =
    status === "done" ? (
      <Badge variant="outline">Done</Badge>
    ) : (
      <Badge variant="secondary">Open</Badge>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">
        {MANUFACTURING_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
