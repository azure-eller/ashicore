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
  stock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
});

// Update schema: itemType, unitDefinitionId are immutable after creation.
// stock only applies at creation (populates the default lot).
export const updateItemSchema = insertItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  stock: true,
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;

// Extends update schema with optional stock field for adjustments.
export const updateItemWithStockSchema = updateItemSchema.extend({
  stock: z.string().refine(
    (v) => !v || parseFloat(v) >= 0,
    "Must be a non-negative number"
  ).optional(),
});

export type UpdateItemWithStock = z.infer<typeof updateItemWithStockSchema>;
