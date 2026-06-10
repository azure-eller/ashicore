import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { withAuthedOrgContext, getAuthedMemberContext } from "@/lib/dal/auth";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import { createBomRevisionInTx, type BomInputRow } from "@/lib/inventory/queries/bom-write";
import { getCurrentBomOperationCostsInTx } from "@/lib/bom/operation-costs";

const bomRowSchema = z.object({
  componentId: z.string().uuid("Component is required"),
  quantity: z.string().refine(
    isPositiveNumberString,
    "Quantity must be a positive number",
  ),
  minimumLotAgeDays: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
      if (value == null) return null;
      const parsed = typeof value === "string" ? Number(value) : value;
      return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
    }),
  alternates: z
    .array(z.object({ itemId: z.string().uuid() }))
    .optional()
    .default([]),
}).strict();

const operationCostRowSchema = z.object({
  operationName: z.string().trim().min(1, "Operation name is required"),
  resourceId: z.string().uuid("Resource is required"),
  costScalingMode: z.literal("per_output_unit"),
  crewSize: z.string(),
  plannedMinutes: z.string(),
  loadedCostPerHour: z.string().nullable().optional(),
});

export const createBomRevisionSchema = z.object({
    recipeBasis: z.enum(["unit", "batch"]).default("unit"),
    expectedBatchYield: z.string().nullable().optional(),
    outputQuantity: z
      .string()
      .nullable()
      .optional()
      .refine((value) => {
        if (value == null) return true;
        return isPositiveNumberString(value);
      }, "Recipe output must be greater than 0"),
    bom: z.array(bomRowSchema).default([]),
    operationCosts: z.array(operationCostRowSchema).optional(),
    note: z
      .string()
      .nullable()
      .optional()
      .transform((value) => (value ?? null) || null),
  })
  .strict()
  .superRefine((value, ctx) => {
  if (value.recipeBasis !== "batch") return;
  if (!isPositiveNumberString(String(value.expectedBatchYield ?? value.outputQuantity ?? ""))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected output per batch must be greater than 0",
      path: ["expectedBatchYield"],
    });
  }
});

export type CreateBomRevisionInput = z.infer<typeof createBomRevisionSchema>;

/**
 * Persist a new BOM revision for `productId`. Marks the previous current
 * revision as superseded and inserts a new one with the provided rows.
 * The card UI's Recipe tab calls this via `POST /api/items/:id/bom-revisions`
 * instead of going through the heavy `PUT /api/items/:id`.
 */
export async function createBomRevision(
  productId: string,
  data: CreateBomRevisionInput,
) {
  const { userId } = await getAuthedMemberContext();
  return withAuthedOrgContext(async (tx, orgId) => {
    const recipeBasis = data.recipeBasis ?? "unit";
    const expectedBatchYield =
      recipeBasis === "batch"
        ? data.expectedBatchYield ?? data.outputQuantity ?? null
        : null;
    const outputQuantity = recipeBasis === "batch" ? expectedBatchYield : "1";

    await tx
      .update(items)
      .set({
        manufacturingMode: recipeBasis === "batch" ? "batch" : "discrete",
        expectedBatchYield,
        updatedAt: new Date(),
      })
      .where(eq(items.id, productId));

    const operationCosts =
      data.operationCosts ??
      (await getCurrentBomOperationCostsInTx(tx, productId)).map((row) => ({
        operationName: row.operationName,
        resourceId: row.resourceId,
        costScalingMode: "per_output_unit" as const,
        crewSize: row.crewSize,
        plannedMinutes: row.plannedMinutes,
        loadedCostPerHour: row.loadedCostPerHour,
      }));

    const result = await createBomRevisionInTx(tx, {
      orgId,
      userId,
      productId,
      note: data.note ?? null,
      outputQuantity,
      recipeBasis,
      bom: data.bom as BomInputRow[],
      operationCosts,
    });
    return { revisionId: result.id, revisionNumber: result.revisionNumber };
  });
}
