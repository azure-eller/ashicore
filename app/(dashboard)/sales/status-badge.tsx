import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SALES_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
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
        {SALES_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
