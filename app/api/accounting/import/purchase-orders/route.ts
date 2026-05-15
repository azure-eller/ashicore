import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { applyAccountingPurchaseOrderImport } from "@/lib/accounting/import-purchase-orders";
import {
  ACCOUNTING_PROVIDERS,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/constants";
import { accountingProviderErrorToResponse } from "@/lib/accounting/providers/errors";

const bodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1),
  provider: z.enum(ACCOUNTING_PROVIDERS).default(ACCOUNTING_PROVIDER_XERO),
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = bodySchema.parse(await request.json());

  try {
    const result = await applyAccountingPurchaseOrderImport(
      context.orgId,
      body.candidateIds,
      { actorUserId: context.userId, provider: body.provider }
    );
    return NextResponse.json(result);
  } catch (error) {
    const providerResponse = accountingProviderErrorToResponse(error);
    if (providerResponse) return providerResponse;
    throw error;
  }
});
