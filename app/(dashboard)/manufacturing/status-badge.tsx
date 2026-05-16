import { StatusLabel } from "@/components/ui/status-label";
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
  const label =
    status === "done" ? (
      <StatusLabel tone="success">Done</StatusLabel>
    ) : (
      <StatusLabel tone="info">Open</StatusLabel>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top">
        {MANUFACTURING_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
