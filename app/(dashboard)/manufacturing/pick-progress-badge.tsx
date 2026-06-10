import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
import { PICK_PROGRESS_TOOLTIP } from "@/lib/tooltip-copy";
import type { ManufacturingPickProgressStatus } from "@/lib/manufacturing/types";

const pickProgressStatusConfig = {
  not_started: {
    label: "Not Started",
    tone: "neutral",
    tooltip: PICK_PROGRESS_TOOLTIP.not_started,
  },
  in_progress: {
    label: "In Progress",
    tone: "warning",
    tooltip: PICK_PROGRESS_TOOLTIP.in_progress,
  },
  picked: {
    label: "Done",
    tone: "success",
    tooltip: PICK_PROGRESS_TOOLTIP.picked,
  },
} satisfies StatusBadgeConfig<ManufacturingPickProgressStatus>;

export function ManufacturingPickProgressBadge({
  status,
}: {
  status: ManufacturingPickProgressStatus;
}) {
  return <StatusBadge status={status} config={pickProgressStatusConfig} />;
}
