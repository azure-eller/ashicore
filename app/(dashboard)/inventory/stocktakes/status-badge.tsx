import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
import { STOCKTAKE_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { StocktakeStatus } from "@/lib/schemas/stocktakes";

const stocktakeStatusConfig = {
  draft: {
    label: "Draft",
    tone: "neutral",
    tooltip: STOCKTAKE_STATUS_TOOLTIP.draft,
  },
  completed: {
    label: "Completed",
    tone: "success",
    tooltip: STOCKTAKE_STATUS_TOOLTIP.completed,
  },
  cancelled: {
    label: "Cancelled",
    tone: "danger",
    tooltip: STOCKTAKE_STATUS_TOOLTIP.cancelled,
  },
  deleted: {
    label: "Deleted",
    tone: "danger",
    tooltip: STOCKTAKE_STATUS_TOOLTIP.deleted,
  },
} satisfies StatusBadgeConfig<StocktakeStatus>;

export function StocktakeStatusBadge({ status }: { status: StocktakeStatus }) {
  return <StatusBadge status={status} config={stocktakeStatusConfig} />;
}
