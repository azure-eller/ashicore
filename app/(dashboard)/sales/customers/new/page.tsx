import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerForm } from "@/app/(dashboard)/sales/customer-form";
import { getCustomerCategoryOptions } from "@/app/(dashboard)/sales/queries";

export default async function NewCustomerPage() {
  await requireModuleWriteAccess("sales");
  const customerCategories = await getCustomerCategoryOptions();

  return <CustomerForm customerCategories={customerCategories} />;
}
