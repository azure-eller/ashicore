import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertSalesOrderSchema } from "@/lib/schemas/sales-orders";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createSalesOrder,
  deleteSalesOrders,
  getSalesOrders,
  SalesError,
} from "@/app/(dashboard)/sales/queries";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getSalesOrders();
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteSalesOrders");
  const data = await parseJsonBody(request, bulkDeleteSchema);
  try {
    const result = await deleteSalesOrders(data.ids, { idempotencyKey });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createSalesOrder");
  const data = await parseJsonBody(request, insertSalesOrderSchema);

  try {
    const order = await createSalesOrder(data, { idempotencyKey });
    return jsonCreated(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
