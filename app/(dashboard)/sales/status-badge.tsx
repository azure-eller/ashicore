import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SALES_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  let badge;

  if (status === "confirmed") {
    badge = <Badge>Confirmed</Badge>;
  } else if (status === "partially_shipped") {
    badge = <Badge variant="secondary">Partially Shipped</Badge>;
  } else if (status === "shipped") {
    badge = <Badge variant="outline">Shipped</Badge>;
  } else if (status === "cancelled") {
    badge = <Badge variant="destructive">Cancelled</Badge>;
  } else {
    badge = <Badge variant="secondary">Open</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">
        {SALES_ORDER_STATUS_TOOLTIP[status]}
      </TooltipContent>
    </Tooltip>
  );
}
