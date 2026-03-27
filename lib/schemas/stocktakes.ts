import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stocktakes } from "@/lib/db/schema";
import { nullableString } from "./shared";

export const STOCKTAKE_SCOPES = ["all", "material", "product"] as const;
export type StocktakeScope = (typeof STOCKTAKE_SCOPES)[number];

export const STOCKTAKE_STATUSES = ["draft", "completed", "cancelled"] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export const insertStocktakeSchema = createInsertSchema(stocktakes, {
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer"),
  scope: z.enum(STOCKTAKE_SCOPES),
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  status: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStocktake = z.infer<typeof insertStocktakeSchema>;

const rawCountLineSchema = z.object({
  lineId: z.string().min(1),
  countedQty: nullableString,
});

export const updateStocktakeCountsSchema = z
  .object({
    lines: z.array(rawCountLineSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();

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
  })
  .transform(({ lines }) => ({
    lines: lines.map((line) => ({
      lineId: line.lineId,
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
