import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getItemAllocationSheetData } from "@/app/(dashboard)/sales/allocation-service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("sales", request.headers);

  const { id } = await (ctx as RouteContext).params;
  const data = await getItemAllocationSheetData(id);

  if (!data) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json(data);
});
