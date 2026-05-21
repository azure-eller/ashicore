import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);

  return NextResponse.json(
    { error: "Supplier price sync from accounting purchase history has been retired. Import open purchase orders from accounting instead." },
    { status: 410 }
  );
});
