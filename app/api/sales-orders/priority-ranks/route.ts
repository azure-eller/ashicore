import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { reorderSalesOrderPriorityRanksSchema } from "@/lib/schemas/sales-orders";
import {
  reorderSalesOrderPriorityRanks,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = reorderSalesOrderPriorityRanksSchema.parse(body);

  try {
    const result = await reorderSalesOrderPriorityRanks(data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
