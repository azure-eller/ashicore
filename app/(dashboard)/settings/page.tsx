import type { Metadata } from "next";
import { canManageTeam, hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getXeroConnection } from "@/lib/dal/xero";
import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";
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
  const canImportSuppliers = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );
  const showIntegrations = canManageXero || canImportSuppliers;

  const sections = getSettingsSections({ showTeam, showIntegrations });

  const [accountData, teamData, xeroConnection, resolvedSearchParams] = await Promise.all([
    getAccountPageData(),
    showTeam ? getTeamPageData() : null,
    showIntegrations ? getXeroConnection() : null,
    searchParams,
  ]);

  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div className="pointer-events-none absolute left-0 top-0 z-30">
        <div className="pointer-events-auto">
          <SidebarCollapsedBar />
        </div>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      <div className="mt-8 flex flex-col-reverse gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_160px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <AccountSection initialData={accountData} />
          {teamData ? <TeamSection initialData={teamData} /> : null}
          {showIntegrations ? (
            <IntegrationsSection
              connection={xeroConnection}
              error={resolvedSearchParams.error}
              canManageConnection={canManageXero}
              canImportCustomers={canManageXero}
              canImportSuppliers={canImportSuppliers}
            />
          ) : null}
        </div>

        <SettingsNav sections={sections} />
      </div>
    </div>
  );
}
