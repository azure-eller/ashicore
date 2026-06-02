import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { createPurchaseBillSchema } from "@/lib/schemas/purchase-orders";
import { createPurchaseBillAccountingSync } from "@/app/(dashboard)/purchasing/queries";
import { XeroError } from "@/lib/xero/errors";
import { QuickBooksError } from "@/lib/accounting/providers/quickbooks/client";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  void requireIdempotencyKey(request, "createPurchaseBill");
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, createPurchaseBillSchema);

  try {
    const result = await createPurchaseBillAccountingSync(id, data);
    return NextResponse.json(result.result);
  } catch (error) {
    if (error instanceof XeroError || error instanceof QuickBooksError) {
      return error.toResponse();
    }
    throw error;
  }
});
