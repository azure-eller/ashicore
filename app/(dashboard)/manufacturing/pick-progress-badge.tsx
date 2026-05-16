import { StatusLabel } from "@/components/ui/status-label";
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
  let label;

  if (status === "picked") {
    label = <StatusLabel tone="success">Done</StatusLabel>;
  } else if (status === "in_progress") {
    label = <StatusLabel tone="warning">In Progress</StatusLabel>;
  } else {
    label = <StatusLabel tone="neutral">Not Started</StatusLabel>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top">{PICK_PROGRESS_TOOLTIP[status]}</TooltipContent>
    </Tooltip>
  );
}
