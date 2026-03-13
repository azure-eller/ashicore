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
});

// Update schema: itemType, inStock, and unitDefinitionId are immutable after creation.
// Changing unitDefinitionId would corrupt any existing stock movements or BOM lines.
export const updateItemSchema = insertItemSchema.omit({
  itemType: true,
  inStock: true,
  unitDefinitionId: true,
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
