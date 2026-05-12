import { NextResponse } from "next/server";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedApiMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { getAuthedXeroClient } from "@/lib/xero/client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "@/lib/xero/errors";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const canUseAccounts =
    hasModuleAccess(context.assignedRoles, "sales", "operate") ||
    hasModuleAccess(context.assignedRoles, "purchasing", "operate") ||
    hasModuleAccess(context.assignedRoles, "inventory", "operate");
  if (!canUseAccounts) {
    throw new AuthorizationError("You do not have permission to view Xero accounts.", 403);
  }

  return withAuthedOrgContext(async (_tx, orgId) => {
    try {
      const authed = await getAuthedXeroClient(orgId);
      const response = await authed.client.accountingApi.getAccounts(
        authed.tenantId
      );
      const accounts = (response.body.accounts ?? [])
        .filter((account) => String(account.status) === "ACTIVE" && account.code)
        .map((account) => ({
          code: account.code ?? "",
          name: account.name ?? account.code ?? "",
          type: account.type ? String(account.type) : null,
          taxType: account.taxType ?? null,
          class: account._class ? String(account._class) : null,
        }))
        .sort((left, right) => left.code.localeCompare(right.code));

      return NextResponse.json({ accounts });
    } catch (error) {
      if (error instanceof XeroError) return error.toResponse();
      console.error("Xero list accounts failed:", redactXeroError(error));
      return NextResponse.json(
        { error: extractXeroMessage(error) },
        { status: 502 }
      );
    }
  });
});
