import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getProducedTodayOrders } from "@/lib/manufacturing/produced-today";

export const GET = apiHandler(async (request) => {
  const context = await assertModuleReadAccess("manufacturing", request.headers);
  const data = await getProducedTodayOrders(context.organizationTimeZone);
  return NextResponse.json(data);
});
