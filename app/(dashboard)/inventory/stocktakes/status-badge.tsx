import { StatusLabel } from "@/components/ui/status-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { STOCKTAKE_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { StocktakeStatus } from "@/lib/schemas/stocktakes";

export function StocktakeStatusBadge({ status }: { status: StocktakeStatus }) {
  let label;

  if (status === "draft") {
    label = <StatusLabel tone="neutral">Draft</StatusLabel>;
  } else if (status === "completed") {
    label = <StatusLabel tone="success">Completed</StatusLabel>;
  } else {
    label = <StatusLabel tone="danger">Deleted</StatusLabel>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top">{STOCKTAKE_STATUS_TOOLTIP[status]}</TooltipContent>
    </Tooltip>
  );
}
