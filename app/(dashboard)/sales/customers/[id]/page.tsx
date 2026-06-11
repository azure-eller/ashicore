import { redirect } from "next/navigation";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";
import { getCustomerCategoryOptions } from "@/lib/sales/queries/customer-categories";
import { getCustomerDetail } from "@/lib/sales/queries/customers-read";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleReadAccess("sales");
  const { id } = await params;
  const [customer, addresses, categories] = await Promise.all([
    getCustomerDetail(id, { includeDeleted: true }),
    getAddressEntries(),
    getCustomerCategoryOptions(),
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
    />
  );
}
