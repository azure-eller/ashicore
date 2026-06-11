import type { Metadata } from "next";
import { DashboardModuleShell } from "@/components/dashboard-shell";
import { canManageTeam, hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getSettingsGroups } from "./sections";
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
  const groups = getSettingsGroups({
    showTeam,
    showAgentAccess: showTeam,
    showIntegrations: canManageSalesXero || canManagePurchasingXero,
    showTaxes,
    showAddresses,
    showBilling: showTeam,
    showUnits,
    showLocations: showUnits,
  });

  return (
    <DashboardModuleShell className="bg-[var(--color-surface-alt)]">
      <div
        className="grid w-full max-w-6xl gap-(--space-8) lg:grid-cols-[218px_minmax(0,1fr)] lg:gap-(--space-16)"
        style={{
          marginInlineStart:
            "clamp(0px, calc((100vw - 72rem) / 2), calc(var(--space-24) * 3 + var(--space-8)))",
        }}
      >
        <SettingsNav groups={groups} />
        <div className="min-w-0">{children}</div>
      </div>
    </DashboardModuleShell>
  );
}
