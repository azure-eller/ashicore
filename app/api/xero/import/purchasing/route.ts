import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { applyXeroPurchasingSync } from "@/lib/xero/import-purchasing";
import { XeroError } from "@/lib/xero/errors";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

const bodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1),
  allowDemoCompany: z.boolean().optional(),
});

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = bodySchema.parse(await request.json());

  try {
    const result = await applyXeroPurchasingSync(context.orgId, body.candidateIds, {
      allowDemoCompany: body.allowDemoCompany ?? false,
    });
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_import",
      outcome: "success",
      source: "POST /api/xero/import/purchasing",
      localEntityType: "purchasing",
      localEntityId: result.runId,
      metadata: {
        entityType: "purchasing",
        selectedCount: body.candidateIds.length,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errorCount: result.errors.length,
        createdSuppliers: result.createdSuppliers,
        createdItems: result.createdItems,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) {
      await tryRecordAccountingAuditEvent({
        organizationId: context.orgId,
        actor: { type: "user", userId: context.userId },
        eventType: "xero_import",
        outcome: "failure",
        source: "POST /api/xero/import/purchasing",
        localEntityType: "purchasing",
        metadata: {
          selectedCount: body.candidateIds.length,
          ...accountingAuditErrorMetadata(error),
        },
      });
      return error.toResponse();
    }
    throw error;
  }
});
