import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { SupplierForm } from "@/app/(dashboard)/purchasing/supplier-form";

export default async function NewSupplierPage() {
  await requireModuleWriteAccess("purchasing");
  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <SupplierForm />
    </div>
  );
}
