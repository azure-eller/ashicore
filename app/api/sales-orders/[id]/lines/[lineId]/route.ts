import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchSalesOrderLineSchema } from "@/lib/schemas/sales-orders";
import { patchSalesOrderLine } from "@/app/(dashboard)/sales/queries";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "patchSalesOrderLine");
  const { id, lineId } = (await (ctx as RouteContext).params) as {
    id: string;
    lineId: string;
  };
  const data = await parseJsonBody(request, patchSalesOrderLineSchema);

  const order = await patchSalesOrderLine(id, lineId, data, { idempotencyKey });
  if (!order) {
    return jsonNotFound("Line not found");
  }
  return NextResponse.json(order);
});
