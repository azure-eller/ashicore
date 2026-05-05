import { z } from "zod";
import type { ModuleKey } from "@/lib/authz";

export const ERP_ENTITY_TYPES = [
  "customer",
  "customer_category",
  "supplier",
  "item",
  "sales_order",
  "purchase_order",
  "manufacturing_order",
  "stocktake",
] as const;

export const ERP_WRITE_ENTITY_TYPES = [
  "customer",
  "customer_category",
  "supplier",
  "sales_order",
  "purchase_order",
  "manufacturing_order",
] as const;

export type ErpEntityType = (typeof ERP_ENTITY_TYPES)[number];
export type ErpWriteEntityType = (typeof ERP_WRITE_ENTITY_TYPES)[number];

export const erpEntityTypeSchema = z.enum(ERP_ENTITY_TYPES);
export const erpWriteEntityTypeSchema = z.enum(ERP_WRITE_ENTITY_TYPES);

export const ERP_ENTITY_MODULE: Record<ErpEntityType, ModuleKey> = {
  customer: "sales",
  customer_category: "sales",
  supplier: "purchasing",
  item: "inventory",
  sales_order: "sales",
  purchase_order: "purchasing",
  manufacturing_order: "manufacturing",
  stocktake: "inventory",
};

export const ERP_READ_MODULES = [
  "inventory",
  "sales",
  "manufacturing",
  "purchasing",
] as const satisfies ModuleKey[];

const searchHitBaseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  badges: z.array(z.string()),
  matchedOn: z.array(z.string()),
});

export const customerSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("customer"),
});

export const customerCategorySearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("customer_category"),
});

export const supplierSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("supplier"),
});

export const itemSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("item"),
});

export const salesOrderSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("sales_order"),
});

export const purchaseOrderSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("purchase_order"),
});

export const manufacturingOrderSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("manufacturing_order"),
});

export const stocktakeSearchHitSchema = searchHitBaseSchema.extend({
  entityType: z.literal("stocktake"),
});

export const erpSearchHitSchema = z.discriminatedUnion("entityType", [
  customerSearchHitSchema,
  customerCategorySearchHitSchema,
  supplierSearchHitSchema,
  itemSearchHitSchema,
  salesOrderSearchHitSchema,
  purchaseOrderSearchHitSchema,
  manufacturingOrderSearchHitSchema,
  stocktakeSearchHitSchema,
]);

export const erpSearchOutputSchema = z.object({
  items: z.array(erpSearchHitSchema),
  truncated: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
});

export const erpListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  status: z.string().nullable().optional(),
  badges: z.array(z.string()),
  updatedAt: z.string().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

export const erpRecordSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  status: z.string().nullable().optional(),
  badges: z.array(z.string()),
  fields: z.record(z.string(), z.unknown()),
});

export const erpGetOutputSchema = z.object({
  entityType: erpEntityTypeSchema,
  record: erpRecordSchema,
});

export const erpListOutputSchema = z.object({
  entityType: erpEntityTypeSchema,
  items: z.array(erpListItemSchema),
  truncated: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
});

export const erpWriteOutputSchema = z.object({
  action: z.enum(["created", "updated"]),
  entityType: erpEntityTypeSchema,
  record: erpRecordSchema,
});

export type ErpSearchHit = z.infer<typeof erpSearchHitSchema>;
export type ErpSearchOutput = z.infer<typeof erpSearchOutputSchema>;
export type ErpListItem = z.infer<typeof erpListItemSchema>;
export type ErpRecord = z.infer<typeof erpRecordSchema>;
export type ErpGetOutput = z.infer<typeof erpGetOutputSchema>;
export type ErpListOutput = z.infer<typeof erpListOutputSchema>;
export type ErpWriteOutput = z.infer<typeof erpWriteOutputSchema>;
