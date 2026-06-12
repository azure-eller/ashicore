import { NextResponse } from "next/server";
import { getManufacturingProductTemplates } from "@/lib/manufacturing/queries/orders-read";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const [products, batchAccess] = await Promise.all([
    getManufacturingProductTemplates(),
    getFeatureAccessForCurrentOrg("batch_production"),
  ]);

  // This endpoint lists creatable MO products (web + Android pickers); batch
  // products aren't creatable for locked orgs.
  return NextResponse.json(
    batchAccess.locked
      ? products.filter((product) => product.manufacturingMode !== "batch")
      : products
  );
});
