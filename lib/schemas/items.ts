import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";

const nullableString = z
  .string()
  .nullable()
  .transform((v) => (v != null ? v.trim() || null : null));

export const insertItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  description: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  committedQty: true,
  expectedQty: true,
  safetyStock: true,
  defaultSellingPrice: true,
}).extend({
  initialStock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
});

// Update schema: itemType, unitDefinitionId are immutable after creation.
// initialStock only applies at creation (populates the default lot).
export const updateItemSchema = insertItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  initialStock: true,
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;

// Schema for the API request that combines item metadata + optional stock adjustment.
// Separate from updateItemSchema to avoid polluting the UpdateItem type.
export const updateItemWithStockSchema = updateItemSchema.extend({
  newStock: z.string().refine(
    (v) => !v || parseFloat(v) >= 0,
    "Must be a non-negative number"
  ).optional(),
});

export type UpdateItemWithStock = z.infer<typeof updateItemWithStockSchema>;
