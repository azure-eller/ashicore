import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";
import { getCustomerCategoryOptions } from "@/lib/sales/queries/customer-categories";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

export default async function CustomerDraftPage() {
  await requireModuleWriteAccess("sales");
  const [addresses, categories, crmAccess] = await Promise.all([
    getAddressEntries(),
    getCustomerCategoryOptions(),
    getFeatureAccessForCurrentOrg("crm"),
  ]);

  return (
    <CustomerCard
      initialCustomerId={null}
      initialCustomer={null}
      addresses={addresses}
      categories={categories}
      crmLocked={crmAccess.locked}
    />
  );
}
