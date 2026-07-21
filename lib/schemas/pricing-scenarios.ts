import { z } from "zod";
import { clientIdSchema, expectedVersionSchema } from "./shared";
import {
  isNonNegativeNumberString,
  optionalNonNegativeDecimalString,
} from "./numeric";

export const PRICING_SCENARIO_CALCULATION_VERSION = "sales-share-v1" as const;

export const PRICING_SCENARIO_MAX_PRODUCTS = 200;
const MAX_OVERRIDE_ROWS = 500;

const overrideDecimal = (label: string) => optionalNonNegativeDecimalString(label);

/** "35" = 35%. Null means not configured (treated as 0). */
const percentValue = (label: string) =>
  z
    .string()
    .nullable()
    .transform((value) => (value != null ? value.trim() || null : null))
    .refine(
      (value) => value == null || (isNonNegativeNumberString(value) && Number(value) < 100),
      `${label} must be between 0 and 100`
    );

const materialOverrideSchema = z.object({
  itemId: z.string().uuid(),
  price: overrideDecimal("Price"),
  inboundFreight: overrideDecimal("Inbound freight"),
  handling: overrideDecimal("Handling"),
});

const resourceRateOverrideSchema = z.object({
  resourceId: z.string().uuid(),
  rate: overrideDecimal("Rate"),
});

const productValueSchema = z.object({
  itemId: z.string().uuid(),
  currentPrice: overrideDecimal("Current price"),
  outboundFreight: overrideDecimal("Outbound freight"),
});

function uniqueBy<T>(rows: T[], key: (row: T) => string) {
  return new Set(rows.map(key)).size === rows.length;
}

export const pricingScenarioDocSchema = z
  .object({
    productIds: z
      .array(z.string().uuid())
      .max(PRICING_SCENARIO_MAX_PRODUCTS, "Too many products"),
    materials: z.array(materialOverrideSchema).max(MAX_OVERRIDE_ROWS),
    resourceRates: z.array(resourceRateOverrideSchema).max(MAX_OVERRIDE_ROWS),
    products: z.array(productValueSchema).max(MAX_OVERRIDE_ROWS),
    overheadPercent: percentValue("Overhead"),
    targetProfitPercent: percentValue("Target profit"),
  })
  .superRefine((doc, ctx) => {
    if (!uniqueBy(doc.productIds, (id) => id)) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "Duplicate product" });
    }
    if (!uniqueBy(doc.materials, (row) => row.itemId)) {
      ctx.addIssue({ code: "custom", path: ["materials"], message: "Duplicate material override" });
    }
    if (!uniqueBy(doc.resourceRates, (row) => row.resourceId)) {
      ctx.addIssue({ code: "custom", path: ["resourceRates"], message: "Duplicate resource rate" });
    }
    if (!uniqueBy(doc.products, (row) => row.itemId)) {
      ctx.addIssue({ code: "custom", path: ["products"], message: "Duplicate product values" });
    }
    const overhead = Number(doc.overheadPercent ?? "0");
    const targetProfit = Number(doc.targetProfitPercent ?? "0");
    if (overhead + targetProfit >= 100) {
      ctx.addIssue({
        code: "custom",
        path: ["targetProfitPercent"],
        message: "Overhead plus target profit must be below 100%",
      });
    }
  });

export type PricingScenarioDoc = z.infer<typeof pricingScenarioDocSchema>;
export type PricingScenarioMaterialOverride = PricingScenarioDoc["materials"][number];
export type PricingScenarioResourceRateOverride =
  PricingScenarioDoc["resourceRates"][number];
export type PricingScenarioProductValues = PricingScenarioDoc["products"][number];

const scenarioNameSchema = z.string().trim().min(1, "Name is required").max(120);

export const insertPricingScenarioSchema = z.object({
  id: clientIdSchema,
  name: scenarioNameSchema,
  doc: pricingScenarioDocSchema,
});
export type InsertPricingScenario = z.infer<typeof insertPricingScenarioSchema>;

export const updatePricingScenarioSchema = z.object({
  name: scenarioNameSchema,
  doc: pricingScenarioDocSchema,
  expectedVersion: expectedVersionSchema,
});
export type UpdatePricingScenario = z.infer<typeof updatePricingScenarioSchema>;

export const duplicatePricingScenarioSchema = z.object({
  name: scenarioNameSchema.optional(),
});

export const commitPricingScenarioRevisionSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500, "Note is too long")
    .transform((value) => value || null)
    .nullable()
    .optional(),
});
export type CommitPricingScenarioRevision = z.infer<
  typeof commitPricingScenarioRevisionSchema
>;

/**
 * Revision snapshots are resolved reports: the server computes them once at
 * commit and they are never recomputed, so they carry both inputs and results.
 * Derived row costs default to null when parsing snapshots committed before
 * costPerUnit was added.
 */
const snapshotDecimal = z.string();
const snapshotNullableDecimal = z.string().nullable();

const revisionMaterialTermSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  quantityPerUnit: snapshotDecimal,
  unitPrice: snapshotNullableDecimal,
  inboundFreight: snapshotNullableDecimal,
  handling: snapshotNullableDecimal,
  priceSource: z.enum(["baseline", "override"]),
  costPerUnit: snapshotNullableDecimal.default(null),
});

const revisionLaborTermSchema = z.object({
  resourceId: z.string().uuid().nullable(),
  name: z.string(),
  hoursPerUnit: snapshotDecimal,
  rate: snapshotNullableDecimal,
  rateSource: z.enum(["baseline", "override"]),
  costPerUnit: snapshotNullableDecimal.default(null),
});

const revisionResultSchema = z.union([
  z.object({
    withheld: z.literal(false),
    sellAt: snapshotDecimal,
    newCost: snapshotDecimal,
    overheadDollars: snapshotDecimal,
    profitDollars: snapshotDecimal,
    currentMargin: snapshotNullableDecimal,
  }),
  z.object({
    withheld: z.literal(true),
    issues: z.array(z.string()).min(1),
  }),
]);

const revisionProductSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  materials: z.array(revisionMaterialTermSchema),
  labor: z.array(revisionLaborTermSchema),
  buckets: z.object({
    materials: snapshotNullableDecimal,
    inboundFreight: snapshotNullableDecimal,
    handling: snapshotNullableDecimal,
    labor: snapshotNullableDecimal,
    directCost: snapshotNullableDecimal,
    costToRecover: snapshotNullableDecimal,
  }),
  outboundFreight: snapshotNullableDecimal,
  currentPrice: snapshotNullableDecimal,
  currentPriceSource: z.enum(["baseline", "override"]),
  result: revisionResultSchema,
});

export const pricingScenarioRevisionSnapshotSchema = z.object({
  calculationVersion: z.literal(PRICING_SCENARIO_CALCULATION_VERSION),
  capturedAt: z.string(),
  globals: z.object({
    overheadPercent: snapshotNullableDecimal,
    targetProfitPercent: snapshotNullableDecimal,
  }),
  products: z.array(revisionProductSchema),
});
export type PricingScenarioRevisionSnapshot = z.infer<
  typeof pricingScenarioRevisionSnapshotSchema
>;
export type PricingScenarioRevisionProduct = z.infer<typeof revisionProductSchema>;

export function emptyPricingScenarioDoc(): PricingScenarioDoc {
  return {
    productIds: [],
    materials: [],
    resourceRates: [],
    products: [],
    overheadPercent: null,
    targetProfitPercent: null,
  };
}
