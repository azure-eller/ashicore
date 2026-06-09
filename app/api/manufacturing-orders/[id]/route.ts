import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  patchManufacturingOrderSchema,
  updateManufacturingOrderSchema,
} from "@/lib/schemas/manufacturing-orders";
import { deleteManufacturingOrder, getManufacturingOrder, patchManufacturingOrder, updateManufacturingOrder } from "@/app/(dashboard)/manufacturing/queries";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const order = await getManufacturingOrder(id);

  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateManufacturingOrderSchema);

  const updated = await updateManufacturingOrder(id, data);

  if (!updated) {
    return jsonNotFound("Order not found");
  }

  const order = await getManufacturingOrder(id);
  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, patchManufacturingOrderSchema);

  const patched = await patchManufacturingOrder(id, data);

  if (!patched) {
    return jsonNotFound("Order not found");
  }

  const order = await getManufacturingOrder(id);
  if (!order) {
    return jsonNotFound("Order not found");
  }

  return NextResponse.json(order);
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const result = await deleteManufacturingOrder(id);

  if (result.error) {
    return jsonError(result.error);
  }

  if (!result.deleted) {
    return jsonNotFound("Order not found");
  }

  return jsonSuccess();
});
