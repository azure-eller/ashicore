import { Badge } from "@/components/ui/badge";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

export function ManufacturingOrderStatusBadge({
  status,
}: {
  status: ManufacturingOrderStatus;
}) {
  if (status === "released") {
    return <Badge>In Progress</Badge>;
  }

  if (status === "completed") {
    return <Badge variant="outline">Completed</Badge>;
  }

  if (status === "cancelled") {
    return <Badge variant="destructive">Cancelled</Badge>;
  }

  return <Badge variant="secondary">Draft</Badge>;
}
