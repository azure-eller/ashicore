import { jsonCreated } from "@/lib/api/responses";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  assertLockedBomManagementAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";
import {
  copyCurrentBomToVariants,
  hasLockedBomCopyTarget,
  InventoryError,
} from "@/app/(dashboard)/inventory/queries";

const bomCopySchema = z.object({
  targetVariantIds: z.array(z.string().uuid()).optional(),
  note: z.string().trim().nullable().optional(),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyItemCardBom");
  const { itemId } = await ((ctx as RouteContext).params as unknown as Promise<{
    itemId: string;
  }>);
  const data = await parseJsonBody(request, bomCopySchema);

  try {
    if (await hasLockedBomCopyTarget(itemId, data.targetVariantIds)) {
      await assertLockedBomManagementAccess(request.headers);
    }

    const result = await copyCurrentBomToVariants(
      itemId,
      data.targetVariantIds,
      data.note ?? null,
      { idempotencyKey },
    );
    return jsonCreated(result);
  } catch (error) {
    if (error instanceof InventoryError) return error.toResponse();
    throw error;
  }
});
