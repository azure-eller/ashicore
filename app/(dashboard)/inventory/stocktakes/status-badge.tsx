import { Badge } from "@/components/ui/badge";
import type { StocktakeStatus } from "@/lib/schemas/stocktakes";

export function StocktakeStatusBadge({ status }: { status: StocktakeStatus }) {
  if (status === "draft") {
    return <Badge variant="secondary">Draft</Badge>;
  }

  if (status === "completed") {
    return <Badge variant="outline">Completed</Badge>;
  }

  return <Badge variant="destructive">Cancelled</Badge>;
}
