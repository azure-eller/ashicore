import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PICK_PROGRESS_TOOLTIP } from "@/lib/tooltip-copy";
import type { ManufacturingPickProgressStatus } from "./types";

export function ManufacturingPickProgressBadge({
  status,
}: {
  status: ManufacturingPickProgressStatus;
}) {
  let badge;

  if (status === "picked") {
    badge = <Badge variant="outline">Picked</Badge>;
  } else if (status === "in_progress") {
    badge = <Badge>In Progress</Badge>;
  } else {
    badge = <Badge variant="secondary">Not Started</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top">{PICK_PROGRESS_TOOLTIP[status]}</TooltipContent>
    </Tooltip>
  );
}
