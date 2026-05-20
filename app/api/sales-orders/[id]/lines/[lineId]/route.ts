import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { patchSalesOrderLineSchema } from "@/lib/schemas/sales-orders";
import { patchSalesOrderLine, SalesError } from "@/app/(dashboard)/sales/queries";

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "patchSalesOrderLine");
  const { id, lineId } = (await (ctx as RouteContext).params) as {
    id: string;
    lineId: string;
  };
  const data = patchSalesOrderLineSchema.parse(await request.json());

  try {
    const order = await patchSalesOrderLine(id, lineId, data, { idempotencyKey });
    if (!order) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
