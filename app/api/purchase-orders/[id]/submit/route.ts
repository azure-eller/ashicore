import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { PurchasingError, submitPurchaseOrder } from "@/app/(dashboard)/purchasing/queries";

const submitOptionsSchema = z
  .object({
    syncAccounting: z.boolean().optional(),
    sendEmail: z.boolean().optional(),
  })
  .optional();

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "submitPurchaseOrder");
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json().catch(() => undefined);
  const options = submitOptionsSchema.parse(body) ?? {};

  try {
    const order = await submitPurchaseOrder(id, { idempotencyKey, ...options });

    if (!order) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
