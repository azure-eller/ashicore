import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
import { MANUFACTURING_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

const manufacturingOrderStatusConfig = {
  open: {
    label: "Open",
    tone: "info",
    tooltip: MANUFACTURING_ORDER_STATUS_TOOLTIP.open,
  },
  done: {
    label: "Done",
    tone: "success",
    tooltip: MANUFACTURING_ORDER_STATUS_TOOLTIP.done,
  },
} satisfies StatusBadgeConfig<ManufacturingOrderStatus>;

export function ManufacturingOrderStatusBadge({
  status,
}: {
  status: ManufacturingOrderStatus;
}) {
  return <StatusBadge status={status} config={manufacturingOrderStatusConfig} />;
}
