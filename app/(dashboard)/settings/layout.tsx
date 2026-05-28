import type { Metadata } from "next";
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
  const sections = getSettingsSections({
    showTeam,
    showAgentAccess: showTeam,
    showIntegrations: canManageSalesXero || canManagePurchasingXero,
    showReports: showTeam,
  });

  return (
    <div className="flex flex-1 flex-col p-4 md:px-6 md:py-5">
      <div className="grid min-h-0 gap-(--space-10) xl:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav sections={sections} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
