import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingExecutionQueue } from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const data = await getManufacturingExecutionQueue();
  return NextResponse.json(data);
});
