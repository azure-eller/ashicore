"use client";

import {
  OrderStatusControl,
  type OrderStatusControlConfig,
  type OrderStatusOption,
} from "@/components/card-page/order-status-control";
import { patchManufacturingOrder } from "@/lib/api/clients/manufacturing-orders";
import { deriveProductionStatus } from "@/lib/manufacturing/derive-status";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingPickProgressStatus } from "@/app/(dashboard)/manufacturing/types";
import { ManufacturingCompletionDialog } from "./manufacturing-completion-dialog";

/**
 * The minimal fields the status control needs — satisfied by both the full order
 * detail (header) and a list row, so the same control renders in both places.
 */
export type ManufacturingStatusFields = {
  id: string;
  status: ManufacturingOrderStatus;
  isBlocked: boolean;
  pickProgressStatus: ManufacturingPickProgressStatus;
  completedBatchCount: number;
};

type Ctx = { order: ManufacturingStatusFields };

const OPTIONS: OrderStatusOption[] = [
  { value: "not_started", label: "Not started", tone: "neutral" },
  { value: "blocked", label: "Blocked", tone: "danger" },
  { value: "in_progress", label: "Work in progress", tone: "warning" },
  { value: "partially_complete", label: "Partially complete", tone: "warning" },
  { value: "done", label: "Done", tone: "success" },
];

const config: OrderStatusControlConfig<Ctx> = {
  type: "manufacturing",
  options: () => OPTIONS,
  current: ({ order }) =>
    deriveProductionStatus({
      status: order.status,
      isBlocked: order.isBlocked,
      pickProgressStatus: order.pickProgressStatus,
      completedBatchCount: order.completedBatchCount,
    }),
  transitionKind: (from, to) => {
    if (from === "done") return "disabled";
    if (to === from) return "noop";
    if (to === "partially_complete" || to === "done") return "dialog";
    // not_started / in_progress / blocked are instant block-flag toggles
    return "instant";
  },
  runInstant: (to, { order }) =>
    patchManufacturingOrder(order.id, { isBlocked: to === "blocked" }).then(() => undefined),
  renderDialog: ({ to, ctx, onClose, onDone }) => {
    if (to !== "done" && to !== "partially_complete") return null;
    return (
      <ManufacturingCompletionDialog
        orderId={ctx.order.id}
        mode={to === "done" ? "complete" : "output"}
        onClose={onClose}
        onDone={onDone}
      />
    );
  },
};

export function ManufacturingStatusControl({
  order,
  size = "md",
  onChanged,
}: {
  order: ManufacturingStatusFields;
  size?: "sm" | "md";
  onChanged?: () => void;
}) {
  return (
    <OrderStatusControl
      config={config}
      ctx={{ order }}
      size={size}
      disabled={order.status === "done"}
      onChanged={onChanged}
    />
  );
}
