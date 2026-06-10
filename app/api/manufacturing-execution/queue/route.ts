import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingExecutionQueue } from "@/lib/manufacturing/queries/execution-read";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const queue = await getManufacturingExecutionQueue();
  return NextResponse.json(queue);
});
