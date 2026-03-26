import { Badge } from "@/components/ui/badge";
import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  if (status === "confirmed") {
    return <Badge>Confirmed</Badge>;
  }

  if (status === "cancelled") {
    return <Badge variant="destructive">Cancelled</Badge>;
  }

  return <Badge variant="secondary">Draft</Badge>;
}
