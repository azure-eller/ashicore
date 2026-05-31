import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { applyAccountingPurchaseOrderImport } from "@/lib/accounting/import-purchase-orders";
import {
  ACCOUNTING_PROVIDERS,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/constants";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import { accountingProviderErrorToResponse } from "@/lib/accounting/providers/errors";

const bodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1),
  provider: z.enum(ACCOUNTING_PROVIDERS).default(ACCOUNTING_PROVIDER_XERO),
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = await parseJsonBody(request, bodySchema);

  try {
    const result = await applyAccountingPurchaseOrderImport(
      context.orgId,
      body.candidateIds,
      { actorUserId: context.userId, provider: body.provider }
    );
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "accounting_import",
      outcome: "success",
      source: "POST /api/accounting/import/purchase-orders",
      provider: body.provider,
      localEntityType: "purchase_orders",
      localEntityId: result.runId,
      metadata: {
        entityType: "purchase_orders",
        selectedCount: body.candidateIds.length,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        protected: result.protected,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 10),
        createdSuppliers: result.createdSuppliers,
        createdItems: result.createdItems,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const providerResponse = accountingProviderErrorToResponse(error);
    if (providerResponse) {
      await tryRecordAccountingAuditEvent({
        organizationId: context.orgId,
        actor: { type: "user", userId: context.userId },
        eventType: "accounting_import",
        outcome: "failure",
        source: "POST /api/accounting/import/purchase-orders",
        provider: body.provider,
        localEntityType: "purchase_orders",
        metadata: {
          selectedCount: body.candidateIds.length,
          ...accountingAuditErrorMetadata(error),
        },
      });
      return providerResponse;
    }
    throw error;
  }
});
