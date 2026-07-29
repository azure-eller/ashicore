import "server-only";

import { getAuthedXeroClient } from "./client";
import { XeroError, extractXeroStatusCode, redactXeroError, extractXeroMessage } from "./errors";
import { parseProfitAndLoss } from "@/lib/overhead/parse";
import {
  isXeroReconnectStatus,
  type ProfitAndLossLine,
} from "@/lib/overhead/compute";

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
 * The P&L report requires the `accounting.reports.read` scope. Every way the
 * connection can fail to authorise — missing scope (403), dead refresh token
 * (401), or no connection at all (409) — is surfaced as one 403 XeroError with
 * `reason: "missing_scope"`, because they all have the same fix: re-run the
 * Xero consent flow. The caller prompts a reconnect instead of dead-ending on a
 * message the operator can't act on.
 */
export async function fetchOverheadInputs(
  orgId: string,
  fromDate: string,
  toDate: string
): Promise<OverheadInputs> {
  try {
    // Inside the guard: loading/refreshing the connection can itself fail on an
    // expired or revoked token, which is a reconnect condition just like a
    // missing scope. Left outside, it surfaced as a dead-end error with no way
    // for the operator to re-authorise.
    const authed = await getAuthedXeroClient(orgId);
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
    console.error("Xero profit-and-loss fetch failed:", redactXeroError(error));
    const status =
      error instanceof XeroError ? error.status : extractXeroStatusCode(error);
    // Any authorisation failure — missing report scope (403), an expired or
    // revoked token (401), or a connection that never granted access — is
    // recoverable the same way: re-run the Xero consent flow. Surface them all
    // as `missing_scope` so the worksheet offers the reconnect dialog instead
    // of a dead-end error the operator can't act on.
    if (isXeroReconnectStatus(status)) {
      throw new XeroError(
        "Reconnect to Xero to grant read access to your Profit & Loss report.",
        403,
        { reason: "missing_scope" }
      );
    }
    if (error instanceof XeroError) throw error;
    throw new XeroError(extractXeroMessage(error), 502);
  }
}
