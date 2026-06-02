import { z } from "zod";

export const importSessionStatuses = [
  "uploaded",
  "extracting",
  "needs_review",
  "validating",
  "validated",
  "committed",
  "failed",
  "canceled",
] as const;

export type ImportSessionStatus = (typeof importSessionStatuses)[number];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const numericStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d+)?$/.test(value), "Must be a positive number.");

const optionalNumericStringSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value == null || String(value).trim() === "") return null;
    return String(value).trim();
  });

export const provenanceSchema = z
  .array(
    z
      .object({
        fileId: z.string().min(1),
        location: z.string().min(1).optional(),
        sheet: z.string().optional(),
        row: z.union([z.string(), z.number()]).optional(),
        page: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough(),
  )
  .default([]);

const confidenceSchema = z.number().min(0).max(1).default(0.5);

const reviewSchema = z
  .object({
    selected: z.boolean().default(true),
  })
  .default({ selected: true });

const matchSchema = z
  .object({
    suggestion: z.enum(["create", "update", "skip"]),
    existingId: z.string().uuid().optional(),
    matchedBy: z.enum(["sku", "name", "code"]).optional(),
    fieldDiff: z.record(z.string(), z.unknown()).optional(),
  })
  .default({ suggestion: "create" });

export const importUnitSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().trim().min(1),
  size: numericStringSchema,
  uom: z.string().trim().min(1),
  review: reviewSchema,
});

export const importSupplierSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().trim().min(1),
  code: z.string().trim().nullable().optional(),
  contactName: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  match: matchSchema,
  review: reviewSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,
});

export const importCustomerSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().trim().min(1),
  email: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  match: matchSchema,
  review: reviewSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,
});

export const importItemSchema = z.object({
  tempId: z.string().min(1),
  itemType: z.enum(["material", "product"]),
  name: z.string().trim().min(1),
  sku: z.string().trim().nullable().optional(),
  unitRef: z.string().min(1),
  sellable: z.boolean().optional(),
  defaultSupplierRef: z.string().nullable().optional(),
  purchaseUnitRef: z.string().nullable().optional(),
  purchaseToStockFactor: optionalNumericStringSchema,
  defaultPurchasePrice: optionalNumericStringSchema,
  defaultSellingPrice: optionalNumericStringSchema,
  lotTrackingMode: z.enum(["tracked", "untracked"]).default("tracked"),
  match: matchSchema,
  review: reviewSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,
});

export const importOpeningStockSchema = z.object({
  itemRef: z.string().min(1),
  quantity: numericStringSchema,
  unitCost: optionalNumericStringSchema,
  lotNumber: z.string().trim().nullable().optional(),
  receivedAt: isoDateSchema.nullable().optional(),
  review: reviewSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,
});

export const importBomSchema = z.object({
  productRef: z.string().min(1),
  outputQuantity: numericStringSchema,
  outputUnitRef: z.string().min(1),
  components: z.array(
    z.object({
      itemRef: z.string().min(1),
      quantity: numericStringSchema,
      unitRef: z.string().nullable().optional(),
      basis: z.enum(["per_unit", "per_batch"]),
    }),
  ),
  review: reviewSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,
});

export const importPackageSchema = z
  .object({
    version: z.literal("1"),
    openingStockAsOf: isoDateSchema,
    units: z.array(importUnitSchema).default([]),
    suppliers: z.array(importSupplierSchema).default([]),
    customers: z.array(importCustomerSchema).default([]),
    items: z.array(importItemSchema).default([]),
    openingStock: z.array(importOpeningStockSchema).default([]),
    boms: z.array(importBomSchema).default([]),
    unresolvedQuestions: z
      .array(
        z.object({
          id: z.string().min(1),
          entityRef: z.string().nullable().optional(),
          question: z.string().min(1),
          options: z.array(z.string()).optional(),
          severity: z.enum(["warning", "blocking"]).default("warning"),
        }),
      )
      .default([]),
  })
  .strict();

export const partialImportPackageSchema = importPackageSchema
  .partial()
  .extend({ version: z.literal("1").default("1") });

export type ImportPackage = z.infer<typeof importPackageSchema>;
export type PartialImportPackage = z.infer<typeof partialImportPackageSchema>;

export type PreviewIssue = {
  severity: "warning" | "blocking";
  message: string;
  path?: string;
};

export type PreviewReport = {
  hash: string;
  status: "needs_review" | "validated";
  blockingIssueCount: number;
  warningIssueCount: number;
  issues: PreviewIssue[];
  summary: {
    units: number;
    suppliers: number;
    customers: number;
    items: number;
    openingStock: number;
    boms: number;
  };
};
