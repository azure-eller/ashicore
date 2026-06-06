import { z } from "zod";
import { stockAdjustmentSchema } from "./stock-adjustments";

export const inventoryReconciliationLineSchema = stockAdjustmentSchema.extend({
  itemId: z.string().uuid(),
});

const manualInventoryReconciliationSchema = z.object({
  source: z.object({ kind: z.literal("manual_adjustment") }),
  lines: z.array(inventoryReconciliationLineSchema).min(1).max(1),
});

const stocktakeInventoryReconciliationSchema = z.object({
  source: z.object({
    kind: z.literal("stocktake"),
    stocktakeId: z.string().uuid(),
    confirmStale: z.boolean().optional().default(false),
    reason: z.string().trim().min(1, "Reason is required.").optional(),
  }),
  lines: z.array(inventoryReconciliationLineSchema).max(0).optional().default([]),
});

export const inventoryReconciliationSchema = z.union([
  manualInventoryReconciliationSchema,
  stocktakeInventoryReconciliationSchema,
]);

export type InventoryReconciliationInput = z.infer<
  typeof inventoryReconciliationSchema
>;
export type InventoryReconciliationLineInput = z.infer<
  typeof inventoryReconciliationLineSchema
>;
