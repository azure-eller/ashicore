import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { copyCurrentBomToVariants, InventoryError } from "@/app/(dashboard)/inventory/queries";

const copyToSchema = z.object({
  targetVariantIds: z.array(z.string().uuid()).min(1),
  note: z.string().nullable().optional(),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyBomToVariants");
  const { id } = await (ctx as RouteContext).params;
  const input = copyToSchema.parse(await request.json());
  try {
    const result = await copyCurrentBomToVariants(id, input.targetVariantIds, input.note, {
      idempotencyKey,
    });
    return NextResponse.json({
      revisions: result.copied.map((row) => ({
        variantId: row.id,
        revisionId: row.revisionId,
      })),
    });
  } catch (error) {
    if (error instanceof InventoryError) return error.toResponse();
    throw error;
  }
});
