import { Badge } from "@/components/ui/badge";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

export function PurchaseOrderStatusBadge({
  status,
}: {
  status: PurchaseOrderStatus;
}) {
  if (status === "ordered") {
    return <Badge>Ordered</Badge>;
  }

  if (status === "partial") {
    return <Badge variant="outline">Partially Received</Badge>;
  }

  if (status === "received") {
    return <Badge variant="outline">Received</Badge>;
  }

  if (status === "cancelled") {
    return <Badge variant="destructive">Cancelled</Badge>;
  }

  return <Badge variant="secondary">Draft</Badge>;
}
