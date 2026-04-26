import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getLots } from "@/app/(dashboard)/inventory/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const lots = await getLots(id);

  return NextResponse.json(lots);
});
