import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";

export default async function CustomerDraftPage() {
  await requireModuleWriteAccess("sales");
  const addresses = await getAddressEntries();

  return (
    <CustomerCard
      initialCustomerId={null}
      initialCustomer={null}
      addresses={addresses}
    />
  );
}
