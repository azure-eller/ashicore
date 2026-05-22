import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  return NextResponse.json(
    { error: "Shipment invoices are deprecated. Push the sales order instead." },
    { status: 410 }
  );
});
