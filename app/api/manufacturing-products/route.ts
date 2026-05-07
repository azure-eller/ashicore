import { NextResponse } from "next/server";
import { getManufacturingProductTemplates } from "@/app/(dashboard)/manufacturing/queries";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const products = await getManufacturingProductTemplates();

  return NextResponse.json(products);
});
