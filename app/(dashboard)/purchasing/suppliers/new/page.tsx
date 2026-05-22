import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { createSupplier } from "@/app/(dashboard)/purchasing/queries";
import { supplierDefaultValues } from "@/lib/schemas/suppliers";

export default async function NewSupplierPage() {
  await requireModuleWriteAccess("purchasing");
  const supplier = await createSupplier({
    ...supplierDefaultValues,
    name: "New supplier",
  });
  redirect(`/purchasing/suppliers/${supplier.id}`);
}
