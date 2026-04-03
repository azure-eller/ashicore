import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerCategoryForm } from "@/app/(dashboard)/sales/customer-category-form";
import { getCustomerCategory } from "@/app/(dashboard)/sales/queries";

export default async function EditCustomerCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const { id } = await params;
  const customerCategory = await getCustomerCategory(id);

  if (!customerCategory) {
    redirect("/sales/pricing");
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerCategoryForm initialData={customerCategory} />
    </div>
  );
}
