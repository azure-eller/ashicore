import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updatePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import {
  deletePurchaseOrder,
  getPurchaseOrder,
  PurchasingError,
  updatePurchaseOrder,
} from "@/app/(dashboard)/purchasing/queries";
import { getActiveAccountingProvider } from "@/lib/dal/accounting";


export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const active = await getActiveAccountingProvider();
  const order = await getPurchaseOrder(id, {
    accountingProvider: active.status === "ready" ? active.provider : undefined,
  });

  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updatePurchaseOrderSchema);

  try {
    const order = await updatePurchaseOrder(id, data);

    if (!order) {
      return jsonNotFound("Purchase order not found");
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const result = await deletePurchaseOrder(id);

  if (result.error) {
    return jsonError(result.error);
  }

  if (!result.deleted) {
    return jsonNotFound("Purchase order not found");
  }

  return jsonSuccess();
});
