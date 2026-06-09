import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonCreated } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { createPurchaseOrder, deletePurchaseOrders, getPurchaseOrders } from "@/app/(dashboard)/purchasing/queries";
import { insertPurchaseOrderSchema } from "@/lib/schemas/purchase-orders";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const data = await getPurchaseOrders();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const data = await parseJsonBody(request, insertPurchaseOrderSchema);

  const order = await createPurchaseOrder(data);
  return jsonCreated(order);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);
  const result = await deletePurchaseOrders(data.ids);

  if (result.error) {
    return jsonError(result.error);
  }

  return NextResponse.json(result);
});
