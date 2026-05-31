import { z } from "zod";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonOk } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { AllocationError } from "@/lib/inventory/allocation/errors";
import {
  saveAllocationWorkspace,
  saveManufacturingIngredientGroupAllocationWorkspace,
} from "@/lib/inventory/allocation/service";
import { isPositiveNumberString } from "@/lib/schemas/shared";

const saveSchema = z.object({
  demandType: z.enum([
    "sales_order_line",
    "manufacturing_order_ingredient",
  ]),
  demandId: z.string().uuid(),
  demandIds: z.array(z.string().uuid()).optional(),
  itemId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        sourceType: z.enum(["inventory_lot", "manufacturing_order"]),
        sourceId: z.string().uuid(),
        quantity: z
          .string()
          .trim()
          .min(1, "Quantity is required")
          .refine(isPositiveNumberString, "Quantity must be greater than 0"),
      })
    )
    .default([]),
});

export const POST = apiHandler(async (request: Request) => {
  const input = await parseJsonBody(request, saveSchema);
  const idempotencyKey = requireIdempotencyKey(request, "saveAllocationWorkspace");
  await assertModuleWriteAccess(
    input.demandType === "manufacturing_order_ingredient" ? "manufacturing" : "sales",
    request.headers
  );

  try {
    if (
      input.demandType === "manufacturing_order_ingredient" &&
      input.demandIds &&
      input.demandIds.length > 1
    ) {
      await saveManufacturingIngredientGroupAllocationWorkspace(
        {
          itemId: input.itemId,
          demandIds: input.demandIds,
          allocations: input.allocations,
        },
        { idempotencyKey, returnWorkspace: false }
      );
    } else {
      await saveAllocationWorkspace(input, { idempotencyKey, returnWorkspace: false });
    }
    return jsonOk();
  } catch (error) {
    if (error instanceof AllocationError) return error.toResponse();
    throw error;
  }
});
