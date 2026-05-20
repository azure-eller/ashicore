import { redirect } from "next/navigation";
import { getAddressEntries } from "@/lib/dal/addresses";
import { CustomerCard } from "@/app/(dashboard)/sales/customer-card";
import { getCustomerDetail } from "@/app/(dashboard)/sales/queries";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [customer, addresses] = await Promise.all([
    getCustomerDetail(id, { includeDeleted: true }),
    getAddressEntries(),
  ]);

  if (!customer) {
    redirect("/sales/customers");
  }

  return (
    <CustomerCard
      initialCustomerId={id}
      initialCustomer={customer}
      addresses={addresses}
    />
  );
}
