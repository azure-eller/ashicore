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
import { getDailyManufacturingReportSchedule } from "@/lib/dal/reports";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";
import { AccountSection } from "./account-section";
import { TeamSection } from "./team-section";
import { IntegrationsSection } from "./integrations-section";
import { ReportsSection } from "./reports-section";

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

  const showReports = showTeam;
  const sections = getSettingsSections({ showTeam, showIntegrations, showReports });

  const [
    accountData,
    teamData,
    reportScheduleData,
    xeroConnection,
    quickBooksConnection,
    xeroImportRuns,
    xeroExports,
    resolvedSearchParams,
  ] = await Promise.all([
    getAccountPageData(),
    showTeam ? getTeamPageData() : null,
    showReports ? getDailyManufacturingReportSchedule() : null,
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
    <div className="w-full">
      <div className="grid gap-(--space-10) xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col gap-(--space-10)">
          <AccountSection initialData={accountData} />
          {teamData ? <TeamSection initialData={teamData} /> : null}
          {reportScheduleData ? (
            <ReportsSection initialData={reportScheduleData} />
          ) : null}
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
