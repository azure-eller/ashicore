import { z } from "zod";
import { ADJUSTMENT_REASONS } from "@/lib/db/schema";

function normalizeAdjustmentReason(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "cycle_count":
    // Android clients have historically posted "Stock count"; keep this alias
    // until the mobile contract moves fully to the typed enum.
    case "stock_count":
      return "cycle_count";
    case "found":
    case "found_stock":
      return "found_stock";
    case "damage":
    case "damaged":
    case "damaged_spoiled":
    case "damaged_or_spoiled":
      return "damaged_spoiled";
    case "correction":
    case "data_correction":
    case "recount":
    case "test_stock_target":
    case "lot_quantity_adjustment":
      return "data_correction";
    case "other":
      return "other";
    default:
      return value;
  }
}

export const adjustLotSchema = z
  .object({
    lotId: z.string().uuid().optional(),
    lotNumber: z.string().trim().min(1).max(20).optional(),
    newQuantity: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .refine((lot) => !(lot.lotId && lot.lotNumber), {
    message: "Use either lotId or lotNumber, not both.",
  });

export const stockAdjustmentSchema = z.object({
  reason: z.preprocess(normalizeAdjustmentReason, z.enum(ADJUSTMENT_REASONS)),
  note: z.string().trim().max(500).optional(),
  newQuantity: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  lots: z.array(adjustLotSchema).optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StockAdjustmentLotInput = z.infer<typeof adjustLotSchema>;
