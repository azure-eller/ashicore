import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { receivePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import { PurchasingError, receivePurchaseOrder } from "@/app/(dashboard)/purchasing/queries";


export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "receivePurchaseOrder");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, receivePurchaseOrderSchema);

  try {
    const order = await receivePurchaseOrder(id, data, { idempotencyKey });

    if (!order) {
      return jsonNotFound("Purchase order not found");
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
