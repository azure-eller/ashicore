import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getQuickBooksConnection } from "@/lib/dal/accounting";
import {
  getRecentXeroExports,
  getRecentXeroImportRuns,
  getRecentXeroSyncEvents,
  getXeroConnection,
} from "@/lib/dal/xero";
import { IntegrationsSection } from "../integrations-section";

export default async function SettingsIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await getAuthedMemberContext();
  const canManageSalesXero = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "operate"
  );
  const canManagePurchasingXero = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );

  if (!canManageSalesXero && !canManagePurchasingXero) {
    redirect("/settings/account");
  }

  const purchaseOrderSyncConfigured = Boolean(
    process.env.ACCOUNTING_PURCHASE_ORDER_SYNC_SECRET ??
      process.env.XERO_RETRY_SECRET ??
      process.env.CRON_SECRET
  );

  const [
    xeroConnection,
    quickBooksConnection,
    xeroImportRuns,
    xeroSyncEvents,
    xeroExports,
    resolvedSearchParams,
  ] = await Promise.all([
    getXeroConnection(),
    getQuickBooksConnection(),
    getRecentXeroImportRuns(),
    getRecentXeroSyncEvents(),
    getRecentXeroExports({
      includeSales: canManageSalesXero,
      includePurchasing: false,
    }),
    searchParams,
  ]);

  return (
    <IntegrationsSection
      connection={xeroConnection}
      quickBooksConnection={quickBooksConnection}
      importRuns={xeroImportRuns}
      syncEvents={xeroSyncEvents}
      exportRows={xeroExports}
      purchaseOrderSyncConfigured={purchaseOrderSyncConfigured}
      error={resolvedSearchParams.error}
      canManageConnection={canManageSalesXero}
      canManageSalesXero={canManageSalesXero}
      canManagePurchasingXero={canManagePurchasingXero}
      canImportCustomers={canManageSalesXero}
      canImportSuppliers={canManagePurchasingXero}
    />
  );
}
