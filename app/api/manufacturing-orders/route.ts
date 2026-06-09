import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { insertManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import { createManufacturingOrder, deleteManufacturingOrders, getManufacturingOrder, getManufacturingOrders } from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const data = await getManufacturingOrders();
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);
  const result = await deleteManufacturingOrders(data.ids);

  if (result.error) {
    return jsonError(result.error);
  }

  return NextResponse.json(result);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const data = await parseJsonBody(request, insertManufacturingOrderSchema);

  const created = await createManufacturingOrder(data);
  const order = await getManufacturingOrder(created.id);

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return jsonCreated(order);
});
