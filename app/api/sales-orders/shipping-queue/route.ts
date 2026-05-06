import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getSalesShippingQueue } from "@/app/(dashboard)/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getSalesShippingQueue();
  return NextResponse.json(data);
});
