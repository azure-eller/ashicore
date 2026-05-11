import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { saveSalesLineAllocationSchema } from "@/lib/schemas/sales-orders";
import {
  getSalesAllocationSheetData,
  saveSalesLineAllocation,
  SalesAllocationError,
} from "@/app/(dashboard)/sales/allocation-service";

type RouteContext = { params: Promise<{ lineId: string }> };

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);

  const { lineId } = await (ctx as RouteContext).params;
  const data = await getSalesAllocationSheetData(lineId);

  if (!data) {
    return NextResponse.json({ error: "Sales order line not found" }, { status: 404 });
  }

  return NextResponse.json(data);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);

  const { lineId } = await (ctx as RouteContext).params;
  const data = saveSalesLineAllocationSchema.parse(await request.json());

  try {
    const result = await saveSalesLineAllocation(lineId, data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesAllocationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
