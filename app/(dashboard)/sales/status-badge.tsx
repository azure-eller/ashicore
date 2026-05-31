import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
import { SALES_ORDER_STATUS_TOOLTIP } from "@/lib/tooltip-copy";
import type { SalesOrderStatus } from "@/lib/schemas/sales-orders";

const salesOrderStatusConfig = {
  open: {
    label: "Open",
    tone: "info",
    tooltip: SALES_ORDER_STATUS_TOOLTIP.open,
  },
  done: {
    label: "Done",
    tone: "success",
    tooltip: SALES_ORDER_STATUS_TOOLTIP.done,
  },
} satisfies StatusBadgeConfig<SalesOrderStatus>;

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <StatusBadge status={status} config={salesOrderStatusConfig} />;
}
