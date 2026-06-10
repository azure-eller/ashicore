import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getUnitDefinitions } from "@/lib/inventory/queries/units";
import { UnitsSection } from "../units-section";

export default async function SettingsUnitsPage() {
  const context = await getAuthedMemberContext();
  if (!hasModuleAccess(context.assignedRoles, "inventory", "admin")) {
    redirect("/settings/account");
  }

  const units = await getUnitDefinitions();
  return <UnitsSection initialUnits={units} />;
}
