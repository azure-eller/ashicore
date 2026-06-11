import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getInventoryLocations } from "@/lib/inventory/queries/locations";
import { LocationsSection } from "../locations-section";

export default async function SettingsLocationsPage() {
  const context = await getAuthedMemberContext();
  if (!hasModuleAccess(context.assignedRoles, "inventory", "admin")) {
    redirect("/settings/account");
  }

  const locations = await getInventoryLocations();
  return <LocationsSection initialLocations={locations} />;
}
