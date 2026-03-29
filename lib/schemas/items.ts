import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { nullableStringStrict as nullableString } from "./shared";

const bomQuantitySchema = nullableString
  .refine((value) => value != null, "Quantity is required")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "Quantity must be greater than 0",
  })
  .transform((value) => value as string);

const bomRowSchema = z.object({
  componentId: z.string().min(1, "Component is required"),
  quantity: bomQuantitySchema,
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

function bomRefine(data: { bom?: Array<{ componentId: string }> }, ctx: z.RefinementCtx) {
  if (!data.bom || data.bom.length === 0) return;
  const seen = new Set<string>();
  for (let i = 0; i < data.bom.length; i++) {
    if (seen.has(data.bom[i].componentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate component",
        path: ["bom", i, "componentId"],
      });
    }
    seen.add(data.bom[i].componentId);
  }
}

export const insertItemSchema = baseItemSchema.superRefine(bomRefine);

export type InsertItem = z.infer<typeof insertItemSchema>;
export type InsertItemFormValues = z.input<typeof insertItemSchema>;

// Update schema: itemType, unitDefinitionId are immutable after creation.
// stock is optional — if provided, triggers a stock adjustment.
// bom is inherited from baseItemSchema — no need to re-add it.
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
export type UpdateItemFormValues = z.input<typeof updateItemSchema>;
