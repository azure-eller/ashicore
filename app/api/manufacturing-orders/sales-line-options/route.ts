import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingSalesLineOptions } from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId")?.trim() || undefined;
  const options = await getManufacturingSalesLineOptions(productId);
  return NextResponse.json(options);
});
