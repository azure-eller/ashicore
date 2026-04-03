import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerCategoryForm } from "@/app/(dashboard)/sales/customer-category-form";

export default async function NewCustomerCategoryPage() {
  await requireModuleWriteAccess("sales");

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerCategoryForm />
    </div>
  );
}
