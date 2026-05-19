import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { getManufacturingAllocationDemandRowsInTx } from "@/lib/inventory/allocation/manufacturing-demands";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const { searchParams } = new URL(request.url);
  const itemIds = [...new Set(searchParams.getAll("itemId"))].filter(Boolean);
  const rows = await withAuthedOrgContext((tx, orgId) =>
    getManufacturingAllocationDemandRowsInTx(tx, orgId, itemIds)
  );
  return NextResponse.json(rows);
});
