import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerForm } from "@/app/(dashboard)/sales/customer-form";
import {
  getCustomer,
  getCustomerCategoryOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const { id } = await params;
  const [customer, customerCategories] = await Promise.all([
    getCustomer(id),
    getCustomerCategoryOptions(),
  ]);

  if (!customer) {
    redirect("/sales/customers");
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerForm
        initialData={customer}
        customerCategories={customerCategories}
      />
    </div>
  );
}
