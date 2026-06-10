import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { requestSearchParams } from "@/lib/routing/search-params";
import { getManufacturingSalesLineOptions } from "@/lib/manufacturing/queries";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const searchParams = requestSearchParams(request);
  const productId = searchParams.get("productId")?.trim() || undefined;
  const options = await getManufacturingSalesLineOptions(productId);
  return NextResponse.json(options);
});
