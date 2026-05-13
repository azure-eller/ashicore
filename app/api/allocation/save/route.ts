import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import type { ModuleKey } from "@/lib/authz";
import { AllocationError } from "@/lib/inventory/allocation/errors";
import { saveAllocationWorkspace } from "@/lib/inventory/allocation/service";
import type { AllocationDemandType } from "@/lib/inventory/allocation/types";

const saveSchema = z.object({
  demandType: z.enum(["sales_order_line", "manufacturing_order_ingredient"]),
  demandId: z.string().uuid(),
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
          .refine((value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0;
          }, "Quantity must be greater than 0"),
      })
    )
    .default([]),
});

function allocationWriteModule(demandType: AllocationDemandType): ModuleKey {
  if (demandType === "sales_order_line") return "sales";
  if (demandType === "manufacturing_order_ingredient") return "manufacturing";
  return "inventory";
}

export const POST = apiHandler(async (request: Request) => {
  const input = saveSchema.parse(await request.json());
  await assertModuleWriteAccess(allocationWriteModule(input.demandType), request.headers);

  try {
    const workspace = await saveAllocationWorkspace(input);
    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof AllocationError) return error.toResponse();
    throw error;
  }
});
