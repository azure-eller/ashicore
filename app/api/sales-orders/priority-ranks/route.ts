import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderSalesOrderPriorityRanksSchema } from "@/lib/schemas/sales-orders";
import { reorderSalesOrderPriorityRanks } from "@/lib/sales/queries/priority";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, reorderSalesOrderPriorityRanksSchema);

  const result = await reorderSalesOrderPriorityRanks(data);
  return NextResponse.json(result);
});
