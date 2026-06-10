import { NextResponse } from "next/server";
import { getManufacturingProductTemplates } from "@/lib/manufacturing/queries/orders-read";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const products = await getManufacturingProductTemplates();

  return NextResponse.json(products);
});
