import "server-only";

import { getAuthedXeroClient } from "./client";
import { XeroError, extractXeroStatusCode, redactXeroError, extractXeroMessage } from "./errors";
import { parseProfitAndLoss, type ProfitAndLossLine } from "@/lib/overhead/compute";

/** One chart-of-accounts row, surfaced so the overhead UI can show/override classifications. */
export type XeroAccountSummary = {
  accountId: string;
  code: string | null;
  name: string;
  type: string | null;
};

export type OverheadInputs = {
  plLines: ProfitAndLossLine[];
  accounts: XeroAccountSummary[];
  accountTypeById: Map<string, string | null>;
};

/**
 * Pull the inputs the overhead calculator needs from Xero over [fromDate, toDate]:
 * the Profit & Loss report (amounts per account for the period) and the chart of
 * accounts (account types, for classification). Dates are ISO "YYYY-MM-DD".
 *
 * The P&L report requires the `accounting.reports.read` scope; a connection that
 * predates that scope returns 403, which we surface as a distinct 403 XeroError so
 * the caller can prompt a reconnect rather than treating it as a generic failure.
 */
export async function fetchOverheadInputs(
  orgId: string,
  fromDate: string,
  toDate: string
): Promise<OverheadInputs> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const [plResponse, accountsResponse] = await Promise.all([
      authed.client.accountingApi.getReportProfitAndLoss(
        authed.tenantId,
        fromDate,
        toDate
      ),
      authed.client.accountingApi.getAccounts(authed.tenantId),
    ]);

    const plLines = parseProfitAndLoss(plResponse.body);

    const accounts: XeroAccountSummary[] = (accountsResponse.body.accounts ?? [])
      .filter((account) => account.accountID)
      .map((account) => ({
        accountId: account.accountID as string,
        code: account.code ?? null,
        name: account.name ?? account.code ?? "",
        type: account.type ? String(account.type) : null,
      }));

    const accountTypeById = new Map<string, string | null>(
      accounts.map((account) => [account.accountId, account.type])
    );

    return { plLines, accounts, accountTypeById };
  } catch (error) {
    if (error instanceof XeroError) throw error;
    const status = extractXeroStatusCode(error);
    console.error("Xero profit-and-loss fetch failed:", redactXeroError(error));
    if (status === 403) {
      throw new XeroError(
        "Reconnect to Xero to grant read access to your Profit & Loss report.",
        403,
        { reason: "missing_scope" }
      );
    }
    throw new XeroError(extractXeroMessage(error), 502);
  }
}
