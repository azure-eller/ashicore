import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { SupplierForm } from "@/app/(dashboard)/purchasing/supplier-form";

export default async function NewSupplierPage() {
  await requireModuleWriteAccess("purchasing");
  return <SupplierForm />;
}
