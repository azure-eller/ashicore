import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerForm } from "@/app/(dashboard)/sales/customer-form";
import { getCustomerCategoryOptions } from "@/app/(dashboard)/sales/queries";

export default async function NewCustomerPage() {
  await requireModuleWriteAccess("sales");
  const customerCategories = await getCustomerCategoryOptions();

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerForm customerCategories={customerCategories} />
    </div>
  );
}
