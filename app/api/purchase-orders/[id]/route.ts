import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { updatePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import {
  deletePurchaseOrder,
  getPurchaseOrder,
  PurchasingError,
  updatePurchaseOrder,
} from "@/app/(dashboard)/purchasing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleReadAccess("purchasing", _request.headers);
  const { id } = await (ctx as RouteContext).params;
  const order = await getPurchaseOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updatePurchaseOrderSchema.parse(body);

  try {
    const order = await updatePurchaseOrder(id, data);

    if (!order) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
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
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!result.deleted) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
