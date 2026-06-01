import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAddressEntries } from "@/lib/dal/addresses";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { AddressesSection } from "../addresses-section";

export default async function SettingsAddressesPage() {
  const context = await getAuthedMemberContext();
  const showAddresses =
    hasModuleAccess(context.assignedRoles, "sales", "operate") ||
    hasModuleAccess(context.assignedRoles, "purchasing", "operate");

  if (!showAddresses) {
    redirect("/settings/account");
  }

  const addresses = await getAddressEntries();

  return <AddressesSection initialData={addresses.map(toSettingsAddress)} />;
}

function toSettingsAddress(address: Awaited<ReturnType<typeof getAddressEntries>>[number]) {
  return {
    id: address.id,
    label: address.label,
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    country: address.country,
    deliveryInstructions: address.deliveryInstructions,
    notes: address.notes,
  };
}
