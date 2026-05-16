import { StatusLabel } from "@/components/ui/status-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SALES_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
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
        {SALES_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
