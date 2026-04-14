import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingExecutionDetail } from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const detail = await getManufacturingExecutionDetail(id);

  if (!detail) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
});
