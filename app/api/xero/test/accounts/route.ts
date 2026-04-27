import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { getAuthedXeroClient } from "@/lib/xero/client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "@/lib/xero/errors";
import { blockXeroTestEndpointInProduction } from "@/lib/xero/test-endpoints";

export const dynamic = "force-dynamic";

/**
 * Test-only helper for `pnpm xero:smoke`. Returns the chart of accounts
 * for the connected Xero tenant so the smoke script can pick a valid
 * code at runtime (Demo Company resets every 28 days and the user's
 * pilot tenant has its own COA).
 */
export const GET = apiHandler(async (request: Request) => {
  const blocked = blockXeroTestEndpointInProduction();
  if (blocked) return blocked;

  await assertModuleWriteAccess("sales", request.headers);

  return withAuthedOrgContext(async (_tx, orgId) => {
    try {
      const authed = await getAuthedXeroClient(orgId);
      const response = await authed.client.accountingApi.getAccounts(
        authed.tenantId
      );
      const accounts = (response.body.accounts ?? []).map((account) => ({
        code: account.code,
        name: account.name,
        type: account.type,
        status: account.status,
        taxType: account.taxType,
        class: account._class,
        enablePaymentsToAccount: account.enablePaymentsToAccount,
      }));
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
