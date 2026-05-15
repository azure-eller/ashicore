import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { previewAccountingPurchaseOrderImport } from "@/lib/accounting/import-purchase-orders";
import {
  ACCOUNTING_PROVIDERS,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/constants";
import { accountingProviderErrorToResponse } from "@/lib/accounting/providers/errors";

const bodySchema = z
  .object({
    provider: z.enum(ACCOUNTING_PROVIDERS).default(ACCOUNTING_PROVIDER_XERO),
  })
  .optional();

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = bodySchema.parse(await request.json().catch(() => undefined));

  try {
    const result = await previewAccountingPurchaseOrderImport(
      context.orgId,
      body?.provider ?? ACCOUNTING_PROVIDER_XERO
    );
    return NextResponse.json(result);
  } catch (error) {
    const providerResponse = accountingProviderErrorToResponse(error);
    if (providerResponse) return providerResponse;
    throw error;
  }
});
