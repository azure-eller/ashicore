import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getXeroOnlineInvoiceUrlForSalesOrder } from "@/lib/sales/queries/accounting";
export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("sales", request.headers);

  const result = await getXeroOnlineInvoiceUrlForSalesOrder(id);
  return NextResponse.json(result);
});
