import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getTaxSettings } from "@/lib/dal/tax-settings";
import { TaxRatesSection } from "../tax-rates-section";

export default async function SettingsTaxRatesPage() {
  const context = await getAuthedMemberContext();
  const showTaxes =
    hasModuleAccess(context.assignedRoles, "sales", "operate") ||
    hasModuleAccess(context.assignedRoles, "purchasing", "operate");

  if (!showTaxes) {
    redirect("/settings/account");
  }

  const taxSettings = await getTaxSettings();

  return <TaxRatesSection initialData={taxSettings} />;
}
