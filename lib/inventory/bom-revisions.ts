import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { items } from "@/lib/db/schema";
import { withAuthedOrgContext, getAuthedMemberContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import {
  createBomRevisionInTx,
  hasBomChanged,
  hasBomOperationCostsChanged,
  type BomInputRow,
} from "@/lib/inventory/queries/bom-write";
import { getCurrentBomOperationCostsInTx } from "@/lib/bom/operation-costs";
import {
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import {
  getMinimumLotAgeDays,
  normalizeMinimumLotAgeDays,
} from "@/lib/bom/constraints";

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
    .refine((value) => {
      const normalized = normalizeMinimumLotAgeDays(value);
      return !Number.isNaN(normalized);
    }, "Minimum lot age must be a positive whole number of days")
    .transform((value) => normalizeMinimumLotAgeDays(value)),
  alternates: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        // The Recipe tab saves through this route, so it has to carry the alternate's own
        // quantity too. Zod strips unknown keys, so leaving it out here silently dropped
        // what the editor sent. Optional: recipes saved before alternates carried a
        // quantity fall back to the component's own number.
        quantity: z
          .string()
          .refine(isPositiveNumberString, "Quantity must be a positive number")
          .optional(),
      })
    )
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
 * Persist a BOM revision for `productId`. Changed payloads supersede the
 * current revision and insert a new one; unchanged payloads return the current
 * revision as an idempotent no-op.
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
    const [currentItem] = await tx
      .select({ manufacturingMode: items.manufacturingMode })
      .from(items)
      .where(eq(items.id, productId));

    // Switching a recipe onto batch basis enters the batch_production
    // workflow; editing an already-batch recipe or reverting to unit is free.
    if (recipeBasis === "batch") {
      if (currentItem?.manufacturingMode !== "batch") {
        await assertFeatureAccessInTx(tx, orgId, "batch_production", {
          route: "POST /api/items/[id]/bom-revisions",
        });
      }
    }
    const expectedBatchYield =
      recipeBasis === "batch"
        ? data.expectedBatchYield ?? data.outputQuantity ?? null
        : null;
    const outputQuantity = recipeBasis === "batch" ? expectedBatchYield : "1";

    const operationCosts =
      data.operationCosts ??
      (await getCurrentBomOperationCostsInTx(tx, productId)).map((row) => ({
        operationName: row.operationName,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        resourceType: row.resourceType,
        costScalingMode: "per_output_unit" as const,
        crewSize: row.crewSize,
        plannedMinutes: row.plannedMinutes,
        loadedCostPerHour: row.loadedCostPerHour,
      }));
    const currentRevision = await getCurrentBomRevisionInTx(tx, productId);
    const currentBom = await getCurrentBomComponentsInTx(tx, productId);
    const currentOperationCosts = await getCurrentBomOperationCostsInTx(tx, productId);
    const currentBomInput = currentBom.map((row) => ({
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
      })),
    }));
    const currentOperationCostInput = currentOperationCosts.map((row) => ({
      operationName: row.operationName,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      resourceType: row.resourceType,
      costScalingMode: "per_output_unit" as const,
      crewSize: row.crewSize,
      plannedMinutes: row.plannedMinutes,
      loadedCostPerHour: row.loadedCostPerHour,
    }));
    const recipeChanged =
      !currentRevision ||
      currentRevision.recipeBasis !== recipeBasis ||
      !sameNumeric(currentRevision.outputQuantity, outputQuantity ?? "1");
    const bomChanged = !currentRevision || hasBomChanged(currentBomInput, data.bom);
    const operationCostsChanged =
      !currentRevision ||
      (data.operationCosts !== undefined &&
        hasBomOperationCostsChanged(currentOperationCostInput, operationCosts));

    if (!recipeChanged && !bomChanged && !operationCostsChanged) {
      return {
        created: false as const,
        revisionId: currentRevision.id,
        revisionNumber: currentRevision.revisionNumber,
      };
    }

    await tx
      .update(items)
      .set({
        manufacturingMode: recipeBasis === "batch" ? "batch" : "discrete",
        expectedBatchYield,
        updatedAt: new Date(),
      })
      .where(eq(items.id, productId));

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
    return {
      created: true as const,
      revisionId: result.id,
      revisionNumber: result.revisionNumber,
    };
  });
}

function sameNumeric(left: string | null | undefined, right: string | null | undefined) {
  if (left == null || right == null) {
    return left == null && right == null;
  }
  return Number(left) === Number(right);
}
