import { redirect } from "next/navigation";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";
import { getCustomerCategoryOptions } from "@/lib/sales/queries/customer-categories";
import { getCustomerDetail } from "@/lib/sales/queries/customers-read";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleReadAccess("sales");
  const { id } = await params;
  const [customer, addresses, categories, crmAccess] = await Promise.all([
    getCustomerDetail(id, { includeDeleted: true }),
    getAddressEntries(),
    getCustomerCategoryOptions(),
    getFeatureAccessForCurrentOrg("crm"),
  ]);

  if (!customer) {
    redirect("/sales/customers");
  }

  return (
    <CustomerCard
      initialCustomerId={id}
      initialCustomer={customer}
      addresses={addresses}
      categories={categories}
      crmLocked={crmAccess.locked}
    />
  );
}
