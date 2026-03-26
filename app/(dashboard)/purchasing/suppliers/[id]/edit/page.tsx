import { redirect } from "next/navigation";
import { SupplierForm } from "@/app/(dashboard)/purchasing/supplier-form";
import { getSupplier } from "@/app/(dashboard)/purchasing/queries";

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supplier = await getSupplier(id);

  if (!supplier) {
    redirect("/purchasing/suppliers");
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <SupplierForm initialData={supplier} />
    </div>
  );
}
