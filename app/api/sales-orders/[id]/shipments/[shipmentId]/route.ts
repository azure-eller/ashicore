import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";

export const PATCH = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  return deprecatedShipmentResponse();
});

export const DELETE = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  return deprecatedShipmentResponse();
});

function deprecatedShipmentResponse() {
  return NextResponse.json(
    { error: "Shipment records are deprecated. Edit or delete the sales order instead." },
    { status: 410 }
  );
}
