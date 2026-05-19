import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { copyCurrentBomToVariants, InventoryError } from "@/app/(dashboard)/inventory/queries";

const copyFromSchema = z.object({
  sourceVariantId: z.string().uuid(),
  note: z.string().nullable().optional(),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyBomFromVariant");
  const { id } = await (ctx as RouteContext).params;
  const input = copyFromSchema.parse(await request.json());
  try {
    const result = await copyCurrentBomToVariants(input.sourceVariantId, [id], input.note, {
      idempotencyKey,
    });
    return NextResponse.json({ revisionId: result.copied[0]?.revisionId ?? null });
  } catch (error) {
    if (error instanceof InventoryError) return error.toResponse();
    throw error;
  }
});
