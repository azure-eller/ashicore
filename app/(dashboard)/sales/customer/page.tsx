import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";
import { getCustomerCategoryOptions } from "@/lib/sales/queries";

export default async function CustomerDraftPage() {
  await requireModuleWriteAccess("sales");
  const [addresses, categories] = await Promise.all([
    getAddressEntries(),
    getCustomerCategoryOptions(),
  ]);

  return (
    <CustomerCard
      initialCustomerId={null}
      initialCustomer={null}
      addresses={addresses}
      categories={categories}
    />
  );
}
