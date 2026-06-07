import type { Metadata } from "next";
import { DashboardModuleShell } from "@/components/dashboard-shell";
import { canManageTeam, hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getAuthedMemberContext();
  const showTeam = canManageTeam(context.assignedRoles);
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
  const showTaxes =
    hasModuleAccess(context.assignedRoles, "sales", "operate") ||
    hasModuleAccess(context.assignedRoles, "purchasing", "operate");
  const showAddresses = showTaxes;
  const showUnits = hasModuleAccess(context.assignedRoles, "inventory", "admin");
  const sections = getSettingsSections({
    showTeam,
    showAgentAccess: showTeam,
    showIntegrations: canManageSalesXero || canManagePurchasingXero,
    showTaxes,
    showAddresses,
    showBilling: showTeam,
    showUnits,
  });

  return (
    <DashboardModuleShell>
      <SettingsNav sections={sections} />
      <div className="min-w-0">{children}</div>
    </DashboardModuleShell>
  );
}
