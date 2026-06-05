import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { createLinkedFreightPurchaseOrders } from "@/app/(dashboard)/purchasing/queries";
import { jsonNotFound } from "@/lib/api/responses";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("purchasing", request.headers);
  const result = await createLinkedFreightPurchaseOrders(id);

  if (!result) {
    return jsonNotFound("Purchase order not found");
  }

  return NextResponse.json({ freightPurchaseOrders: result });
});
