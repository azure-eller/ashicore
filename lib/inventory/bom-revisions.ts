import "server-only";

import { z } from "zod";
import { withAuthedOrgContext, getAuthedMemberContext } from "@/lib/dal/auth";
import { createBomRevisionInTx } from "@/app/(dashboard)/inventory/queries/internal";
import type {
  BomInputRow,
  BomOperationCostInputRow,
} from "@/app/(dashboard)/inventory/queries/bom-write";

const bomRowSchema = z.object({
  componentId: z.string().uuid("Component is required"),
  quantity: z.string().refine(
    (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    },
    "Quantity must be a positive number",
  ),
  everyQuantity: z
    .string()
    .nullable()
    .optional()
    .refine((value) => {
      if (value == null) return true;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }, "Every must be greater than 0"),
  consumptionMode: z
    .enum(["per_output_unit", "per_batch", "per_group"])
    .nullable()
    .optional(),
  basisOutputQuantity: z.string().nullable().optional(),
  batchScalingMode: z
    .enum(["proportional", "full_batches_only"])
    .nullable()
    .optional(),
  groupRemainderPolicy: z
    .enum(["ask", "leave_loose", "create_partial_group"])
    .nullable()
    .optional(),
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
});

const operationCostRowSchema = z.object({
  operationName: z.string().trim().min(1, "Operation name is required"),
  resourceId: z.string().uuid("Resource is required"),
  costScalingMode: z.enum(["per_output_unit", "fixed_per_mo"]),
  crewSize: z.string(),
  plannedMinutes: z.string(),
  loadedCostPerHour: z.string().nullable().optional(),
});

export const createBomRevisionSchema = z.object({
  outputQuantity: z
    .string()
    .nullable()
    .optional()
    .refine((value) => {
      if (value == null) return true;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }, "Recipe output must be greater than 0"),
  bom: z.array(bomRowSchema).default([]),
  operationCosts: z.array(operationCostRowSchema).optional(),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value ?? null) || null),
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
    const result = await createBomRevisionInTx(tx, {
      orgId,
      userId,
      productId,
      note: data.note ?? null,
      outputQuantity: data.outputQuantity ?? null,
      bom: data.bom as BomInputRow[],
      operationCosts: data.operationCosts as BomOperationCostInputRow[] | undefined,
    });
    return { revisionId: result.id, revisionNumber: result.revisionNumber };
  });
}
