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
  initialStock: z.string().default("0"),
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
