import { NextResponse } from "next/server";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedApiMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/constants";
import { isAccountingProvider } from "@/lib/accounting/providers";
import { listQuickBooksAccounts } from "@/lib/accounting/providers/quickbooks/accounts";
import { getAuthedXeroClient } from "@/lib/xero/client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "@/lib/xero/errors";
import { QuickBooksError } from "@/lib/accounting/providers/quickbooks/client";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const canUseAccounts =
    hasModuleAccess(context.assignedRoles, "sales", "operate") ||
    hasModuleAccess(context.assignedRoles, "purchasing", "operate") ||
    hasModuleAccess(context.assignedRoles, "inventory", "operate");
  if (!canUseAccounts) {
    throw new AuthorizationError(
      "You do not have permission to view accounting accounts.",
      403
    );
  }

  const { provider } = await (ctx as RouteContext).params;
  if (!isAccountingProvider(provider)) {
    return NextResponse.json(
      { error: "Unsupported accounting provider." },
      { status: 400 }
    );
  }

  return withAuthedOrgContext(async (_tx, orgId) => {
    try {
      if (provider === ACCOUNTING_PROVIDER_QUICKBOOKS) {
        return NextResponse.json({
          accounts: await listQuickBooksAccounts(orgId),
        });
      }

      if (provider === ACCOUNTING_PROVIDER_XERO) {
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
      }

      return NextResponse.json(
        { error: "Unsupported accounting provider." },
        { status: 400 }
      );
    } catch (error) {
      if (error instanceof XeroError || error instanceof QuickBooksError) {
        return error.toResponse();
      }
      console.error("Accounting list accounts failed:", redactXeroError(error));
      return NextResponse.json(
        { error: extractXeroMessage(error) },
        { status: 502 }
      );
    }
  });
});
