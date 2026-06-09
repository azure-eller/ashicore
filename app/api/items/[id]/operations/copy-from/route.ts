import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { copyCurrentOperationsToVariants } from "@/app/(dashboard)/inventory/queries";

const copyFromSchema = z.object({
  sourceVariantId: z.string().uuid(),
  note: z.string().nullable().optional(),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "copyOperationsFromVariant");
  const { id } = await (ctx as RouteContext).params;
  const input = await parseJsonBody(request, copyFromSchema);
  const result = await copyCurrentOperationsToVariants(
    input.sourceVariantId,
    [id],
    input.note,
    { idempotencyKey },
  );
  for (const row of result.copied) {
    revalidatePath(`/inventory/products/${row.id}`);
    revalidatePath(`/inventory/products/${row.id}/recipe`);
    revalidatePath(`/inventory/products/${row.id}/production`);
  }
  return NextResponse.json({ revisionId: result.copied[0]?.revisionId ?? null });
});
