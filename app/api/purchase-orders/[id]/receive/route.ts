import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { receivePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import { PurchasingError, receivePurchaseOrder } from "@/app/(dashboard)/purchasing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = receivePurchaseOrderSchema.parse(body);

  try {
    const order = await receivePurchaseOrder(id, data);

    if (!order) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
