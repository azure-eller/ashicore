import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { copyCurrentBomToVariants } from "@/lib/inventory/queries/bom-write";

const copyToSchema = z.object({
  targetVariantIds: z.array(z.string().uuid()).min(1),
  note: z.string().nullable().optional(),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyBomToVariants");
  const { id } = await (ctx as RouteContext).params;
  const input = await parseJsonBody(request, copyToSchema);
  const result = await copyCurrentBomToVariants(id, input.targetVariantIds, input.note, {
    idempotencyKey,
  });
  for (const row of result.copied) {
    revalidatePath(`/inventory/products/${row.id}`);
    revalidatePath(`/inventory/products/${row.id}/recipe`);
    revalidatePath(`/inventory/products/${row.id}/production`);
  }
  return NextResponse.json({
    revisions: result.copied.map((row) => ({
      variantId: row.id,
      revisionId: row.revisionId,
    })),
  });
});
