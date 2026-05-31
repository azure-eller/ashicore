import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { importSuppliersFromXero } from "@/lib/xero/import-contacts";
import { XeroError } from "@/lib/xero/errors";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

const bodySchema = z
  .object({
    allowDemoCompany: z.boolean().optional(),
  })
  .optional();

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();
  const body = await parseOptionalJsonBody(request, bodySchema);

  try {
    const result = await importSuppliersFromXero(context.orgId, {
      allowDemoCompany: body?.allowDemoCompany ?? false,
    });
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_import",
      outcome: "success",
      source: "POST /api/xero/import/suppliers",
      localEntityType: "suppliers",
      localEntityId: result.runId,
      metadata: {
        entityType: "suppliers",
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errorCount: result.errors.length,
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
        source: "POST /api/xero/import/suppliers",
        localEntityType: "suppliers",
        metadata: accountingAuditErrorMetadata(error),
      });
      return error.toResponse();
    }
    throw error;
  }
});
