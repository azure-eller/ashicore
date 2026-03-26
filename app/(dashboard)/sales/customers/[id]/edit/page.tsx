import { redirect } from "next/navigation";
import { CustomerForm } from "@/app/(dashboard)/sales/customer-form";
import { getCustomer } from "@/app/(dashboard)/sales/queries";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id);

  if (!customer) {
    redirect("/sales/customers");
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerForm initialData={customer} />
    </div>
  );
}
