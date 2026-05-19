import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { getManufacturingAllocationDemandRowsInTx } from "@/lib/inventory/allocation/manufacturing-demands";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const rows = await withAuthedOrgContext((tx, orgId) =>
    getManufacturingAllocationDemandRowsInTx(tx, orgId)
  );
  return NextResponse.json(rows);
});
