import type { ManufacturingPickProgressStatus } from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

export const PRODUCTION_STATUSES = [
  "not_started",
  "blocked",
  "in_progress",
  "done",
] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export type ProductionStatusInput = {
  status: ManufacturingOrderStatus;
  isBlocked: boolean;
  pickProgressStatus: ManufacturingPickProgressStatus;
  completedBatchCount?: number | null;
};

export function deriveProductionStatus(input: ProductionStatusInput): ProductionStatus {
  if (input.status === "done") return "done";
  if (input.isBlocked) return "blocked";
  const hasProgress =
    input.pickProgressStatus !== "not_started" ||
    (input.completedBatchCount ?? 0) > 0;
  if (hasProgress) return "in_progress";
  return "not_started";
}

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  not_started: "Not started",
  blocked: "Blocked",
  in_progress: "Work in progress",
  done: "Done",
};
