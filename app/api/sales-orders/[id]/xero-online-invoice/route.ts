import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getXeroOnlineInvoiceUrlForSalesOrder } from "@/app/(dashboard)/sales/queries";
import { XeroError } from "@/lib/xero/errors";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleReadAccess("sales", request.headers);

  try {
    const result = await getXeroOnlineInvoiceUrlForSalesOrder(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
