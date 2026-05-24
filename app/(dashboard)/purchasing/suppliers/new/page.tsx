import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { SupplierCard } from "@/app/(dashboard)/purchasing/supplier-card";

export default async function NewSupplierPage() {
  await requireModuleWriteAccess("purchasing");
  const addresses = await getAddressEntries();

  return (
    <SupplierCard
      initialSupplierId={null}
      initialSupplier={null}
      addresses={addresses}
    />
  );
}
