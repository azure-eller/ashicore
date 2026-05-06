import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { salesFulfillmentPlanInputSchema } from "@/lib/schemas/sales-orders";
import {
  planSalesOrderFulfillment,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);

  const idempotencyKey = requireIdempotencyKey(
    request,
    "planSalesOrderFulfillment"
  );
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = salesFulfillmentPlanInputSchema.parse(body);

  try {
    const result = await planSalesOrderFulfillment(id, data, { idempotencyKey });
    if (!result) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
