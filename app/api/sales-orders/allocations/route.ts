import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  SalesAllocationError,
  unallocateAllSalesOrderAllocations,
} from "@/app/(dashboard)/sales/allocation-service";

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  requireIdempotencyKey(request, "unallocateAllSalesOrderAllocations");

  try {
    const result = await unallocateAllSalesOrderAllocations();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesAllocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
