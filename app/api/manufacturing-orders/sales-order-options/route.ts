import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingSalesOrderOptions } from "@/lib/manufacturing/queries/orders-read";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const options = await getManufacturingSalesOrderOptions();
  return NextResponse.json(options);
});
