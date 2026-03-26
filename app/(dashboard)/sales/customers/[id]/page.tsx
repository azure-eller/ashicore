import { redirect } from "next/navigation";
import { CustomerDetail } from "@/app/(dashboard)/sales/customer-detail";
import { getCustomer } from "@/app/(dashboard)/sales/queries";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id, { includeDeleted: true });

  if (!customer) {
    redirect("/sales/customers");
  }

  return <CustomerDetail customer={customer} />;
}
