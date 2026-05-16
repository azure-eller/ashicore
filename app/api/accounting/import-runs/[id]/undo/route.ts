import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  getXeroImportRunEntityType,
  undoXeroImportRun,
  type ContactImportEntity,
} from "@/lib/xero/import-contacts";
import { XeroError } from "@/lib/xero/errors";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function assertImportResetAccess(
  assignedRoles: string[],
  entityType: ContactImportEntity
) {
  const moduleKey = entityType === "customers" ? "sales" : "purchasing";

  if (!hasModuleAccess(assignedRoles, moduleKey, "admin")) {
    throw new AuthorizationError(
      `You do not have permission to administer ${moduleKey}.`,
      403
    );
  }
}

export const POST = apiHandler(
  async (request: Request, context: RouteContext) => {
    const memberContext = await getAuthedApiMemberContext(request.headers);
    const { id } = await context.params;

    try {
      const entityType = await getXeroImportRunEntityType(memberContext.orgId, id);
      assertImportResetAccess(memberContext.assignedRoles, entityType);
      const result = await undoXeroImportRun(memberContext.orgId, id);
      await tryRecordAccountingAuditEvent({
        organizationId: memberContext.orgId,
        actor: { type: "user", userId: memberContext.userId },
        eventType: "accounting_import_undo",
        outcome: "success",
        source: "POST /api/accounting/import-runs/[id]/undo",
        localEntityType: entityType,
        localEntityId: id,
        metadata: {
          entityType,
          undoneCreatedRows: result.undoneCreatedRows,
          restoredUpdatedRows: result.restoredUpdatedRows,
          blockedRows: result.blockedRows,
        },
      });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof XeroError) {
        await tryRecordAccountingAuditEvent({
          organizationId: memberContext.orgId,
          actor: { type: "user", userId: memberContext.userId },
          eventType: "accounting_import_undo",
          outcome: "failure",
          source: "POST /api/accounting/import-runs/[id]/undo",
          localEntityType: "import_run",
          localEntityId: id,
          metadata: accountingAuditErrorMetadata(error),
        });
        return error.toResponse();
      }
      throw error;
    }
  }
);
