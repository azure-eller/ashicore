import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";

export const PUT = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  return NextResponse.json(
    { error: "Shipment costs are deprecated. Use the sales order shipping fee." },
    { status: 410 }
  );
});
