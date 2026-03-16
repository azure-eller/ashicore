import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";

const nullableString = z
  .string()
  .nullable()
  .transform((v) => (v != null ? v.trim() || null : null));

const bomRowSchema = z.object({
  componentId: z.string().min(1, "Component is required"),
  quantity: nullableString,
  percentage: nullableString,
});

// Base schema without superRefine — used as the foundation for both insert and update.
// superRefine can't be applied before .omit(), so we split it out.
const baseItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  defaultSellingPrice: nullableString,
  description: nullableString,
  safetyStock: z.string().transform((v) => (v.trim() === "" ? "0" : v)),
  bomMode: z.enum(["quantity", "percentage"]).nullable().optional(),
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  committedQty: true,
  expectedQty: true,
}).extend({
  stock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
  bom: z.array(bomRowSchema).optional(),
});

function bomRefine(data: { bomMode?: string | null; bom?: Array<{ quantity: string | null; percentage: string | null }> }, ctx: z.RefinementCtx) {
  if (!data.bom || data.bom.length === 0) return;
  for (let i = 0; i < data.bom.length; i++) {
    const row = data.bom[i];
    if (data.bomMode === "quantity" && !row.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quantity is required",
        path: ["bom", i, "quantity"],
      });
    }
    if (data.bomMode === "percentage" && !row.percentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage is required",
        path: ["bom", i, "percentage"],
      });
    }
  }
}

export const insertItemSchema = baseItemSchema.superRefine(bomRefine);

export type InsertItem = z.infer<typeof insertItemSchema>;

// Update schema: itemType, unitDefinitionId are immutable after creation.
// stock is optional — if provided, triggers a stock adjustment.
// bom and bomMode are inherited from baseItemSchema — no need to re-add them.
export const updateItemSchema = baseItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  stock: true,
}).extend({
  stock: z.string().refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ).optional(),
}).superRefine(bomRefine);

export type UpdateItem = z.infer<typeof updateItemSchema>;
