import "server-only";

import { and, eq, ne } from "drizzle-orm";
import {
  ACCOUNTING_PROVIDER_LABELS,
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  ACCOUNTING_PROVIDERS,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import { integrationConnections } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { withOrgContext } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";

export type AccountingConnectionSummary = {
  provider: AccountingProvider;
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: Date;
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: string;
  autoPushSalesInvoices: boolean;
  autoSyncPurchaseOrdersFromAccounting: boolean;
  autoEmailSalesInvoices: boolean;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: string;
  updatedAt: Date;
};

export type ActiveAccountingProvider =
  | {
      status: "none";
      provider: null;
      label: null;
      connection: null;
      connections: AccountingConnectionSummary[];
    }
  | {
      status: "ready";
      provider: AccountingProvider;
      label: string;
      connection: AccountingConnectionSummary;
      connections: AccountingConnectionSummary[];
    }
  | {
      status: "conflict";
      provider: null;
      label: null;
      connection: null;
      connections: AccountingConnectionSummary[];
    };

function toAccountingSummary(
  row: typeof integrationConnections.$inferSelect
): AccountingConnectionSummary {
  return {
    provider: row.provider as AccountingProvider,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tokenExpiresAt: row.tokenExpiresAt,
    defaultAccountCode: row.defaultAccountCode,
    defaultTaxType: row.defaultTaxType,
    invoiceStatusPreference: row.invoiceStatusPreference,
    autoPushSalesInvoices: row.autoPushSalesInvoices,
    autoSyncPurchaseOrdersFromAccounting:
      row.autoSyncPurchaseOrdersFromAccounting,
    autoEmailSalesInvoices: row.autoEmailSalesInvoices,
    purchaseOrderDefaultAccountCode: row.purchaseOrderDefaultAccountCode,
    purchaseOrderDefaultTaxType: row.purchaseOrderDefaultTaxType,
    purchaseOrderStatusPreference: row.purchaseOrderStatusPreference,
    updatedAt: row.updatedAt,
  };
}

export function isActiveAccountingReady(
  state: ActiveAccountingProvider
): state is Extract<ActiveAccountingProvider, { status: "ready" }> {
  return state.status === "ready";
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

export async function getAccountingConnections() {
  return withAuthedOrgContext(async (tx, orgId) => {
    const rows = await tx
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, orgId));
    return rows
      .filter((row) =>
        ACCOUNTING_PROVIDERS.includes(row.provider as AccountingProvider)
      )
      .map(toAccountingSummary);
  });
}

export async function getActiveAccountingProvider(): Promise<ActiveAccountingProvider> {
  const connections = await getAccountingConnections();
  if (connections.length === 0) {
    return {
      status: "none",
      provider: null,
      label: null,
      connection: null,
      connections,
    };
  }
  if (connections.length > 1) {
    return {
      status: "conflict",
      provider: null,
      label: null,
      connection: null,
      connections,
    };
  }

  const [connection] = connections;
  return {
    status: "ready",
    provider: connection.provider,
    label: ACCOUNTING_PROVIDER_LABELS[connection.provider],
    connection,
    connections,
  };
}

export async function getActiveAccountingProviderForOrg(
  orgId: string
): Promise<ActiveAccountingProvider> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, orgId));
    const connections = rows
      .filter((row) =>
        ACCOUNTING_PROVIDERS.includes(row.provider as AccountingProvider)
      )
      .map(toAccountingSummary);
    if (connections.length === 0) {
      return {
        status: "none",
        provider: null,
        label: null,
        connection: null,
        connections,
      };
    }
    if (connections.length > 1) {
      return {
        status: "conflict",
        provider: null,
        label: null,
        connection: null,
        connections,
      };
    }
    const [connection] = connections;
    return {
      status: "ready",
      provider: connection.provider,
      label: ACCOUNTING_PROVIDER_LABELS[connection.provider],
      connection,
      connections,
    };
  });
}

export async function assertNoOtherAccountingConnection(
  orgId: string,
  provider: AccountingProvider
) {
  await withOrgContext(orgId, async (tx) => {
    const [other] = await tx
      .select({ provider: integrationConnections.provider })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          ne(integrationConnections.provider, provider)
        )
      )
      .limit(1);

    if (
      other &&
      ACCOUNTING_PROVIDERS.includes(other.provider as AccountingProvider)
    ) {
      throw new DomainError(
        `${ACCOUNTING_PROVIDER_LABELS[other.provider as AccountingProvider]} is already connected. Disconnect it before connecting ${ACCOUNTING_PROVIDER_LABELS[provider]}.`
        ,
        409
      );
    }
  });
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
  defaultAccountCode?: string | null;
  defaultTaxType?: string | null;
  invoiceStatusPreference?: "DRAFT" | "AUTHORISED";
  autoPushSalesInvoices?: boolean;
  autoSyncPurchaseOrdersFromAccounting?: boolean;
  autoEmailSalesInvoices?: boolean;
  purchaseOrderDefaultAccountCode?: string | null;
  purchaseOrderDefaultTaxType?: string | null;
  purchaseOrderStatusPreference?: "DRAFT" | "SUBMITTED" | "AUTHORISED";
}) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({
        ...(params.defaultAccountCode !== undefined
          ? { defaultAccountCode: params.defaultAccountCode }
          : {}),
        ...(params.defaultTaxType !== undefined
          ? { defaultTaxType: params.defaultTaxType }
          : {}),
        ...(params.invoiceStatusPreference !== undefined
          ? { invoiceStatusPreference: params.invoiceStatusPreference }
          : {}),
        ...(params.autoPushSalesInvoices !== undefined
          ? { autoPushSalesInvoices: params.autoPushSalesInvoices }
          : {}),
        ...(params.autoSyncPurchaseOrdersFromAccounting !== undefined
          ? {
              autoSyncPurchaseOrdersFromAccounting:
                params.autoSyncPurchaseOrdersFromAccounting,
            }
          : {}),
        ...(params.autoEmailSalesInvoices !== undefined
          ? { autoEmailSalesInvoices: params.autoEmailSalesInvoices }
          : {}),
        ...(params.purchaseOrderDefaultAccountCode !== undefined
          ? {
              purchaseOrderDefaultAccountCode:
                params.purchaseOrderDefaultAccountCode,
            }
          : {}),
        ...(params.purchaseOrderDefaultTaxType !== undefined
          ? { purchaseOrderDefaultTaxType: params.purchaseOrderDefaultTaxType }
          : {}),
        ...(params.purchaseOrderStatusPreference !== undefined
          ? {
              purchaseOrderStatusPreference:
                params.purchaseOrderStatusPreference,
            }
          : {}),
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
