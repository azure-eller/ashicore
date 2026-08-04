import { NextResponse } from "next/server";
import {
  apiHandler,
  requireIdempotencyKey,
  type RouteContext,
} from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonConflict, jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { correctPurchaseOrderQuantity } from "@/lib/purchasing/queries/quantity-correction";
import { purchaseOrderQuantityCorrectionSchema } from "@/lib/schemas/purchase-orders";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(
    request,
    "correctPurchaseOrderQuantity",
  );
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, purchaseOrderQuantityCorrectionSchema);
  const result = await correctPurchaseOrderQuantity(id, data, { idempotencyKey });
  if (!result) return jsonNotFound("Purchase order not found");
  if (result.kind === "conflict") {
    return jsonConflict("This purchase order was changed elsewhere.", result.order);
  }
  return NextResponse.json({ order: result.order, impact: result.impact });
});
