import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stocktakes } from "@/lib/db/schema";
import {
  STOCKTAKE_NAME_MAX_LENGTH,
  STOCKTAKE_NAME_MAX_LENGTH_MESSAGE,
} from "@/lib/stocktake-names";
import {
  nonNegativeQuantityString,
  nullableString,
  nullableStringPreserveUndefined,
} from "./shared";

export const STOCKTAKE_SCOPE_ITEM_TYPES = ["material", "product"] as const;
export type StocktakeScopeItemType = (typeof STOCKTAKE_SCOPE_ITEM_TYPES)[number];

export const STOCKTAKE_CREATION_MODES = ["empty", "in_stock", "all"] as const;
export type StocktakeCreationMode = (typeof STOCKTAKE_CREATION_MODES)[number];

export const STOCKTAKE_SCOPES = [
  ...STOCKTAKE_CREATION_MODES,
  ...STOCKTAKE_SCOPE_ITEM_TYPES,
] as const;
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
  | { kind: "empty" }
  | { kind: "in_stock" }
  | { kind: "type"; itemType: StocktakeScopeItemType }
  | { kind: "category"; itemType: StocktakeScopeItemType; category: string } {
  if (scope === "empty") {
    return { kind: "empty" };
  }

  if (scope === "in_stock") {
    return { kind: "in_stock" };
  }

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

export const stocktakeCreationModeSchema = z.enum(STOCKTAKE_CREATION_MODES);

export const insertStocktakeSchema = createInsertSchema(stocktakes, {
  // Count location; omitted = default (mobile sends none).
  locationId: z.string().uuid().nullish(),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(STOCKTAKE_NAME_MAX_LENGTH, STOCKTAKE_NAME_MAX_LENGTH_MESSAGE),
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
  creationMode: stocktakeCreationModeSchema.optional(),
  itemIds: z.array(z.string().min(1)).min(1, "Choose at least one item").optional(),
});

export type InsertStocktake = z.infer<typeof insertStocktakeSchema>;

export const createStocktakeSchema = insertStocktakeSchema.extend({
  reason: z.string().trim().min(1, "Reason is required."),
  itemIds: z.array(z.string().uuid()).optional(),
});

export type CreateStocktake = z.infer<typeof createStocktakeSchema>;

export const cloneStocktakeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(STOCKTAKE_NAME_MAX_LENGTH, STOCKTAKE_NAME_MAX_LENGTH_MESSAGE)
    .optional(),
  reason: z.string().trim().min(1, "Reason is required."),
});

export type CloneStocktake = z.infer<typeof cloneStocktakeSchema>;

const rawCountLineSchema = z.object({
  lineId: z.string().min(1),
  countedQty: nullableString,
  notes: nullableStringPreserveUndefined,
});

const rawCountLotLineSchema = z.object({
  lotLineId: z.string().min(1),
  countedQty: nullableString,
  notes: nullableStringPreserveUndefined,
});

const rawDeleteFoundLotLineSchema = z.object({
  lotLineId: z.string().min(1),
  delete: z.literal(true),
});

const rawFoundLotLineSchema = z.object({
  isFound: z.literal(true),
  stocktakeItemId: z.string().min(1),
  lotNumber: z.string(),
  countedQty: nullableString,
  notes: nullableStringPreserveUndefined,
});

const rawLotLineSchema = z.union([
  rawDeleteFoundLotLineSchema,
  rawFoundLotLineSchema,
  rawCountLotLineSchema,
]);

function isFoundLotLine(
  line: z.infer<typeof rawLotLineSchema>
): line is z.infer<typeof rawFoundLotLineSchema> {
  return "isFound" in line && line.isFound === true;
}

function isDeleteFoundLotLine(
  line: z.infer<typeof rawLotLineSchema>
): line is z.infer<typeof rawDeleteFoundLotLineSchema> {
  return "delete" in line && line.delete === true;
}

function addCountedQuantityIssues(
  value: string,
  path: PropertyKey[],
  ctx: z.RefinementCtx,
) {
  const parsed = nonNegativeQuantityString("Counted quantity").safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: [...path, ...issue.path] });
    }
  }
}

function normalizeCountedQuantity(value: string | null | undefined) {
  if (value == null) return null;
  const parsed = nonNegativeQuantityString("Counted quantity").safeParse(value);
  return parsed.success ? parsed.data : value.trim();
}

export const updateStocktakeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(STOCKTAKE_NAME_MAX_LENGTH, STOCKTAKE_NAME_MAX_LENGTH_MESSAGE)
      .optional(),
    scope: stocktakeScopeSchema.optional(),
    notes: nullableStringPreserveUndefined,
    reason: nullableStringPreserveUndefined,
    itemIds: z.array(z.string().uuid()).optional(),
    lines: z.array(rawCountLineSchema).optional().default([]),
    lotLines: z.array(rawLotLineSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    const seenLots = new Set<string>();
    const seenFoundLots = new Set<string>();

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

      addCountedQuantityIssues(
        line.countedQty,
        ["lines", index, "countedQty"],
        ctx,
      );
    });

    data.lotLines.forEach((line, index) => {
      if (isDeleteFoundLotLine(line)) {
        if (seenLots.has(line.lotLineId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Each lot can only be submitted once",
            path: ["lotLines", index, "lotLineId"],
          });
        } else {
          seenLots.add(line.lotLineId);
        }
        return;
      }

      if (isFoundLotLine(line)) {
        const trimmedLotNumber = line.lotNumber.trim();
        if (trimmedLotNumber.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Lot number is required",
            path: ["lotLines", index, "lotNumber"],
          });
        } else {
          const foundKey = `${line.stocktakeItemId}:${trimmedLotNumber}`;
          if (seenFoundLots.has(foundKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Each found lot can only be submitted once",
              path: ["lotLines", index, "lotNumber"],
            });
          } else {
            seenFoundLots.add(foundKey);
          }
        }

        if (line.countedQty == null || line.countedQty.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Counted quantity is required",
            path: ["lotLines", index, "countedQty"],
          });
        } else {
          addCountedQuantityIssues(
            line.countedQty,
            ["lotLines", index, "countedQty"],
            ctx,
          );
        }
        return;
      }

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

      addCountedQuantityIssues(
        line.countedQty,
        ["lotLines", index, "countedQty"],
        ctx,
      );
    });
  })
  .transform(({ lines, lotLines, name, scope, notes, reason, itemIds }) => ({
    name,
    scope,
    notes,
    reason,
    itemIds,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      countedQty: normalizeCountedQuantity(line.countedQty),
      ...(line.notes !== undefined ? { notes: line.notes?.trim() ?? null } : {}),
    })),
    lotLines: lotLines
      .filter((line) => !isFoundLotLine(line) && !isDeleteFoundLotLine(line))
      .map((line) => {
        const existing = line as z.infer<typeof rawCountLotLineSchema>;
        return {
          lotLineId: existing.lotLineId,
          countedQty: normalizeCountedQuantity(existing.countedQty),
          ...(existing.notes !== undefined
            ? { notes: existing.notes?.trim() ?? null }
            : {}),
        };
      }),
    foundLotLines: lotLines
      .filter(isFoundLotLine)
      .map((line) => ({
        stocktakeItemId: line.stocktakeItemId,
        lotNumber: line.lotNumber.trim(),
        countedQty: normalizeCountedQuantity(line.countedQty),
        ...(line.notes !== undefined ? { notes: line.notes?.trim() ?? null } : {}),
      })),
    deletedLotLineIds: lotLines
      .filter(isDeleteFoundLotLine)
      .map((line) => line.lotLineId),
  }));

export const updateStocktakeCountsSchema = updateStocktakeSchema;
export type UpdateStocktakeCounts = z.infer<typeof updateStocktakeSchema>;

export const completeStocktakeSchema = z.object({
  confirmStale: z.boolean().optional().default(false),
  reason: z.string().trim().min(1, "Reason is required.").optional(),
});

export type CompleteStocktake = z.infer<typeof completeStocktakeSchema>;

export const stocktakeDefaultValues: InsertStocktake = {
  name: "",
  scope: "all",
  creationMode: "all",
  notes: null,
};
