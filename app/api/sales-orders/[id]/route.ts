import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  patchSalesOrderHeaderSchema,
  updateSalesOrderSchema,
} from "@/lib/schemas/sales-orders";
import { deleteSalesOrder, getSalesOrder, patchSalesOrderHeader, updateSalesOrder } from "@/lib/sales/queries";
import { getActiveAccountingProvider } from "@/lib/dal/accounting";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const active = await getActiveAccountingProvider();
  const order = await getSalesOrder(id, {
    accountingProvider: active.status === "ready" ? active.provider : undefined,
  });

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "patchSalesOrderHeader");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, patchSalesOrderHeaderSchema);

  const patched = await patchSalesOrderHeader(id, data, { idempotencyKey });
  if (!patched) {
    return jsonNotFound("Order not found");
  }
  const order = await getSalesOrder(id);
  if (!order) {
    return jsonNotFound("Order not found");
  }
  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateSalesOrder");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateSalesOrderSchema);

  const order = await updateSalesOrder(id, data, { idempotencyKey });

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "deleteSalesOrder");
  const { id } = await (ctx as RouteContext).params;
  const result = await deleteSalesOrder(id, { idempotencyKey });

  if (!result.deleted) {
    return jsonNotFound("Order not found");
  }

  return jsonSuccess();
});
