import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getOverheadSettings, getDefaultOverheadPeriod } from "@/lib/dal/overhead-settings";
import { OverheadPanel } from "./overhead-panel";

export const dynamic = "force-dynamic";

export default async function OverheadPage() {
  const [settings, context] = await Promise.all([
    getOverheadSettings(),
    getAuthedMemberContext(),
  ]);
  const defaultPeriod = getDefaultOverheadPeriod();
  return (
    <OverheadPanel
      initialSettings={settings}
      defaultPeriod={defaultPeriod}
      canOperate={hasModuleAccess(context.assignedRoles, "sales", "operate")}
    />
  );
}
