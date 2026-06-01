import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { createPurchaseBillSchema } from "@/lib/schemas/purchase-orders";
import { createPurchaseBillAccountingSync } from "@/app/(dashboard)/purchasing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  void requireIdempotencyKey(request, "createPurchaseBill");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, createPurchaseBillSchema);

  const result = await createPurchaseBillAccountingSync(id, data);
  return NextResponse.json(result.result);
});
