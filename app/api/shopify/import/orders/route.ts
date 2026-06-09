import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { importPaidShopifyOrders } from "@/lib/shopify/import-orders";
const bodySchema = z
  .object({
    shopBaseUrl: z.string().url().optional(),
  })
  .optional();

function allowShopifyBaseUrlOverride() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_FAST_WORKERS != null
  );
}

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const context = await getAuthedMemberContext();
  const body = await parseOptionalJsonBody(request, bodySchema, {});

  if (body?.shopBaseUrl && !allowShopifyBaseUrlOverride()) {
    return NextResponse.json(
      { error: "Shopify shopBaseUrl overrides are not allowed in production." },
      { status: 400 }
    );
  }

  const result = await importPaidShopifyOrders(context.orgId, {
    shopBaseUrl: body?.shopBaseUrl,
  });
  return NextResponse.json(result);
});
