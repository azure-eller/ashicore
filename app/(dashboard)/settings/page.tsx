import type { Metadata } from "next";
import { canManageTeam, hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getQuickBooksConnection } from "@/lib/dal/accounting";
import {
  getRecentXeroExports,
  getRecentXeroImportRuns,
  getXeroConnection,
} from "@/lib/dal/xero";
import { getAccountPageData, getTeamPageData } from "./queries";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";
import { AccountSection } from "./account-section";
import { TeamSection } from "./team-section";
import { IntegrationsSection } from "./integrations-section";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await getAuthedMemberContext();
  const showTeam = canManageTeam(context.assignedRoles);
  const canManageXero = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "operate"
  );
  const canResetCustomerImports = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "admin"
  );
  const canImportSuppliers = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );
  const canResetSupplierImports = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "admin"
  );
  const showIntegrations = canManageXero || canImportSuppliers;

  const sections = getSettingsSections({ showTeam, showIntegrations });

  const [
    accountData,
    teamData,
    xeroConnection,
    quickBooksConnection,
    xeroImportRuns,
    xeroExports,
    resolvedSearchParams,
  ] = await Promise.all([
    getAccountPageData(),
    showTeam ? getTeamPageData() : null,
    showIntegrations ? getXeroConnection() : null,
    showIntegrations ? getQuickBooksConnection() : null,
    showIntegrations ? getRecentXeroImportRuns() : [],
    showIntegrations
      ? getRecentXeroExports({
          includeSales: canManageXero,
          includePurchasing: canImportSuppliers,
        })
      : [],
    searchParams,
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col-reverse gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_160px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountSection initialData={accountData} />
          {teamData ? <TeamSection initialData={teamData} /> : null}
          {showIntegrations ? (
            <IntegrationsSection
              connection={xeroConnection}
              quickBooksConnection={quickBooksConnection}
              importRuns={xeroImportRuns}
              exportRows={xeroExports}
              error={resolvedSearchParams.error}
              canManageConnection={canManageXero}
              canImportCustomers={canManageXero}
              canImportSuppliers={canImportSuppliers}
              canResetCustomerImports={canResetCustomerImports}
              canResetSupplierImports={canResetSupplierImports}
            />
          ) : null}
        </div>

        <SettingsNav sections={sections} />
      </div>
    </div>
  );
}
