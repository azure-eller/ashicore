import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { getInventoryLocations } from "@/lib/inventory/queries/locations";
import { LocationsSection } from "../locations-section";

export default async function SettingsLocationsPage() {
  const context = await getAuthedMemberContext();
  if (!hasModuleAccess(context.assignedRoles, "inventory", "admin")) {
    redirect("/settings/account");
  }

  const [locations, multiLocationAccess] = await Promise.all([
    getInventoryLocations(),
    getFeatureAccessForCurrentOrg("multi_location"),
  ]);
  return (
    <LocationsSection
      initialLocations={locations}
      multiLocationLocked={multiLocationAccess.locked}
    />
  );
}
