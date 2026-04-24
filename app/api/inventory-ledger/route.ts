import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { parseInventoryLedgerFilters } from "@/app/(dashboard)/inventory/ledger/filters";
import { getInventoryLedger } from "@/app/(dashboard)/inventory/ledger/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { searchParams } = new URL(request.url);
  const filters = parseInventoryLedgerFilters(searchParams);
  const data = await getInventoryLedger(filters);
  return NextResponse.json(data);
});
