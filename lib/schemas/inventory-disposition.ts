import { z } from "zod";
import { INVENTORY_DISPOSITIONS } from "@/lib/db/schema";
import { nullableString, positiveQuantityString } from "./shared";

export const inventoryDispositionSchema = z.enum(INVENTORY_DISPOSITIONS);
export type InventoryDispositionInput = z.infer<typeof inventoryDispositionSchema>;

export const qualityDispositionActionSchema = z.object({
  action: z.enum(["release", "block", "reject", "scrap"]),
  fromDisposition: inventoryDispositionSchema,
  quantity: positiveQuantityString("Quantity"),
  notes: nullableString,
});

export type QualityDispositionAction = z.infer<
  typeof qualityDispositionActionSchema
>;
