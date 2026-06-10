import "server-only";

import { withAuthedOrgContext } from "@/lib/dal/auth";

export async function getXeroOnlineInvoiceUrlForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { getOnlineInvoiceUrlForOrder } = await import("@/lib/xero/push-invoice");
    return { url: await getOnlineInvoiceUrlForOrder(orgId, id) };
  });
}

export async function retryXeroPushForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushSalesOrderToXero, markXeroPushFailed } = await import(
      "@/lib/xero/push-invoice"
    );
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushSalesOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (
        error instanceof XeroError &&
        (error.status === 400 || error.status === 404 || error.status === 409)
      ) {
        throw error;
      }

      await markXeroPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function retryAccountingPushForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { getActiveAccountingProviderForOrg } = await import(
      "@/lib/dal/accounting"
    );
    const active = await getActiveAccountingProviderForOrg(orgId);
    if (active.status === "none") {
      const { DomainError } = await import("@/lib/errors/domain-error");
      throw new DomainError("Connect an accounting provider before sending invoices.", 409);
    }
    if (active.status === "conflict") {
      const { DomainError } = await import("@/lib/errors/domain-error");
      throw new DomainError(
        "Disconnect either Xero or QuickBooks before sending invoices.",
        409
      );
    }

    if (active.provider === "quickbooks") {
      const {
        pushSalesOrderToQuickBooks,
        markQuickBooksInvoicePushFailed,
      } = await import(
        "@/lib/accounting/providers/quickbooks/push-invoice"
      );
      const { QuickBooksError } = await import(
        "@/lib/accounting/providers/quickbooks/client"
      );

      try {
        const result = await pushSalesOrderToQuickBooks(orgId, id);
        return { ok: true as const, provider: active.provider, result };
      } catch (error) {
        if (
          error instanceof QuickBooksError &&
          (error.status === 400 || error.status === 404 || error.status === 409)
        ) {
          throw error;
        }
        await markQuickBooksInvoicePushFailed(orgId, id, error);
        throw error;
      }
    }

    const result = await retryXeroPushForSalesOrder(id);
    return { ...result, provider: active.provider };
  });
}
