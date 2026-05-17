import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stocktakes } from "@/lib/db/schema";
import { nullableString } from "./shared";

export const STOCKTAKE_SCOPE_ITEM_TYPES = ["material", "product"] as const;
export type StocktakeScopeItemType = (typeof STOCKTAKE_SCOPE_ITEM_TYPES)[number];

export const STOCKTAKE_SCOPES = ["all", ...STOCKTAKE_SCOPE_ITEM_TYPES] as const;
export type StocktakeBaseScope = (typeof STOCKTAKE_SCOPES)[number];
export type StocktakeCategoryScope =
  `${StocktakeScopeItemType}:category:${string}`;
export type StocktakeScope = StocktakeBaseScope | StocktakeCategoryScope;

export const STOCKTAKE_STATUSES = ["draft", "completed", "cancelled", "deleted"] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export function buildStocktakeCategoryScope(
  itemType: StocktakeScopeItemType,
  category: string
): StocktakeCategoryScope {
  return `${itemType}:category:${category.trim()}` as StocktakeCategoryScope;
}

function normalizeStocktakeScope(value: string) {
  const trimmed = value.trim();

  const categoryMatch = /^(material|product):category:(.+)$/u.exec(trimmed);
  if (categoryMatch) {
    return buildStocktakeCategoryScope(
      categoryMatch[1] as StocktakeScopeItemType,
      categoryMatch[2]
    );
  }

  return trimmed;
}

export function isStocktakeScope(value: string): value is StocktakeScope {
  if ((STOCKTAKE_SCOPES as readonly string[]).includes(value)) {
    return true;
  }

  const categoryMatch = /^(material|product):category:(.+)$/u.exec(value);
  return categoryMatch != null && categoryMatch[2].trim().length > 0;
}

export function parseStocktakeScope(scope: StocktakeScope):
  | { kind: "all" }
  | { kind: "type"; itemType: StocktakeScopeItemType }
  | { kind: "category"; itemType: StocktakeScopeItemType; category: string } {
  if (scope === "all") {
    return { kind: "all" };
  }

  if ((STOCKTAKE_SCOPE_ITEM_TYPES as readonly string[]).includes(scope)) {
    return {
      kind: "type",
      itemType: scope as StocktakeScopeItemType,
    };
  }

  const categoryMatch = /^(material|product):category:(.+)$/u.exec(scope);
  if (!categoryMatch) {
    return { kind: "all" };
  }

  return {
    kind: "category",
    itemType: categoryMatch[1] as StocktakeScopeItemType,
    category: categoryMatch[2],
  };
}

const stocktakeScopeSchema = z
  .string()
  .transform(normalizeStocktakeScope)
  .refine(isStocktakeScope, "Choose a valid scope");

export const insertStocktakeSchema = createInsertSchema(stocktakes, {
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
  scope: stocktakeScopeSchema,
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  status: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  itemIds: z.array(z.string().min(1)).min(1, "Choose at least one item").optional(),
});

export type InsertStocktake = z.infer<typeof insertStocktakeSchema>;

export const createStocktakeSchema = insertStocktakeSchema.extend({
  itemIds: z.array(z.string().uuid()).optional(),
});

export type CreateStocktake = z.infer<typeof createStocktakeSchema>;

const rawCountLineSchema = z.object({
  lineId: z.string().min(1),
  countedQty: nullableString,
});

const rawCountLotLineSchema = z.object({
  lotLineId: z.string().min(1),
  countedQty: nullableString,
});

export const updateStocktakeCountsSchema = z
  .object({
    lines: z.array(rawCountLineSchema).optional().default([]),
    lotLines: z.array(rawCountLotLineSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    const seenLots = new Set<string>();

    if (data.lines.length === 0 && data.lotLines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Submit at least one count",
        path: ["lines"],
      });
    }

    data.lines.forEach((line, index) => {
      if (seen.has(line.lineId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each line can only be submitted once",
          path: ["lines", index, "countedQty"],
        });
        return;
      }

      seen.add(line.lineId);

      if (line.countedQty == null) {
        return;
      }

      const parsed = Number(line.countedQty);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Counted quantity must be 0 or greater",
          path: ["lines", index, "countedQty"],
        });
      }
    });

    data.lotLines.forEach((line, index) => {
      if (seenLots.has(line.lotLineId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each lot can only be submitted once",
          path: ["lotLines", index, "countedQty"],
        });
        return;
      }

      seenLots.add(line.lotLineId);

      if (line.countedQty == null) {
        return;
      }

      const parsed = Number(line.countedQty);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Counted quantity must be 0 or greater",
          path: ["lotLines", index, "countedQty"],
        });
      }
    });
  })
  .transform(({ lines, lotLines }) => ({
    lines: lines.map((line) => ({
      lineId: line.lineId,
      countedQty: line.countedQty?.trim() ?? null,
    })),
    lotLines: lotLines.map((line) => ({
      lotLineId: line.lotLineId,
      countedQty: line.countedQty?.trim() ?? null,
    })),
  }));

export type UpdateStocktakeCounts = z.infer<typeof updateStocktakeCountsSchema>;

export const completeStocktakeSchema = z.object({
  confirmStale: z.boolean().optional().default(false),
});

export type CompleteStocktake = z.infer<typeof completeStocktakeSchema>;

export const stocktakeDefaultValues: InsertStocktake = {
  name: "",
  scope: "all",
  notes: null,
};
