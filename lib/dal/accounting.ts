import "server-only";

import { and, eq } from "drizzle-orm";
import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import { integrationConnections } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { withOrgContext } from "@/lib/db/with-org-context";

export type AccountingConnectionSummary = {
  provider: AccountingProvider;
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: Date;
  autoSyncPurchaseOrdersFromAccounting: boolean;
};

function toAccountingSummary(
  row: typeof integrationConnections.$inferSelect
): AccountingConnectionSummary {
  return {
    provider: row.provider as AccountingProvider,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tokenExpiresAt: row.tokenExpiresAt,
    autoSyncPurchaseOrdersFromAccounting:
      row.autoSyncPurchaseOrdersFromAccounting,
  };
}

export async function getAccountingConnection(provider: AccountingProvider) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, provider)
        )
      )
      .limit(1);
    return row ? toAccountingSummary(row) : null;
  });
}

export async function getQuickBooksConnection() {
  return getAccountingConnection(ACCOUNTING_PROVIDER_QUICKBOOKS);
}

export async function deleteAccountingConnection(
  orgId: string,
  provider: AccountingProvider
) {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, provider)
        )
      );
  });
}

export async function updateAccountingConnectionSettings(params: {
  provider: AccountingProvider;
  autoSyncPurchaseOrdersFromAccounting: boolean;
}) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({
        autoSyncPurchaseOrdersFromAccounting:
          params.autoSyncPurchaseOrdersFromAccounting,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, params.provider)
        )
      )
      .returning();

    return row ? toAccountingSummary(row) : null;
  });
}
