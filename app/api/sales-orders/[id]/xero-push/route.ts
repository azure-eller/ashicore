import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { retryXeroPushForSalesOrder } from "@/app/(dashboard)/sales/queries";
import { XeroError } from "@/lib/xero/errors";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await assertModuleWriteAccess("sales", request.headers);

  try {
    const result = await retryXeroPushForSalesOrder(id);
    return NextResponse.json(result.result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
