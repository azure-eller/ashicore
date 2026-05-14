import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  shipSalesOrder,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

const shipOptionsSchema = z
	  .object({
	    syncAccounting: z.boolean().optional(),
	    confirmNegativeStock: z.boolean().optional(),
	  })
  .optional();

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "shipSalesOrder");
  const body = await request.json().catch(() => undefined);
  const options = shipOptionsSchema.parse(body) ?? {};

  try {
    const order = await shipSalesOrder(id, { idempotencyKey, ...options });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
