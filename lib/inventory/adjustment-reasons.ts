import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
} from "@/lib/db/schema";

export { ADJUSTMENT_REASONS, type AdjustmentReason };

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  cycle_count: "Cycle count",
  found_stock: "Found stock",
  damaged_spoiled: "Damaged-spoiled",
  data_correction: "Data correction",
  other: "Other",
};

export function formatAdjustmentReason(reason: AdjustmentReason) {
  return ADJUSTMENT_REASON_LABELS[reason];
}
