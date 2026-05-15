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
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof XeroError) return error.toResponse();
      throw error;
    }
  }
);
