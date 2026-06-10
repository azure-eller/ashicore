import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { submitPurchaseOrder } from "@/lib/purchasing/queries";

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
  const options = (await parseOptionalJsonBody(request, submitOptionsSchema)) ?? {};

  const order = await submitPurchaseOrder(id, { idempotencyKey, ...options });

  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  return NextResponse.json(order);
});
