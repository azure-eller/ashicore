import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { STOCKTAKE_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { StocktakeStatus } from "@/lib/schemas/stocktakes";

export function StocktakeStatusBadge({ status }: { status: StocktakeStatus }) {
  let badge;

  if (status === "draft") {
    badge = <Badge variant="secondary">Draft</Badge>;
  } else if (status === "completed") {
    badge = <Badge variant="outline">Completed</Badge>;
  } else {
    badge = <Badge variant="destructive">Deleted</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">{STOCKTAKE_STATUS_TOOLTIP[status]}</TooltipContent>
    </Tooltip>
  );
}
