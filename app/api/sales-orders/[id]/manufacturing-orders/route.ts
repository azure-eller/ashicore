import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { createManufacturingOrdersFromSalesOrderSchema } from "@/lib/schemas/manufacturing-orders";
import { createManufacturingOrdersFromSalesOrder, getManufacturingSalesOrderPreview } from "@/app/(dashboard)/manufacturing/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", request.headers);

  const { id } = await (ctx as RouteContext).params;
  const preview = await getManufacturingSalesOrderPreview(id);

  if (!preview) {
    return jsonNotFound("Sales order not found");
  }

  return NextResponse.json(preview);
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);

  const { id: routeId } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(
    request,
    createManufacturingOrdersFromSalesOrderSchema,
  );

  const result = await createManufacturingOrdersFromSalesOrder(routeId, data);
  return jsonCreated(result);
});
