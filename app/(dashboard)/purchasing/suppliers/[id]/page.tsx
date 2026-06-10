import { redirect } from "next/navigation";
import { SupplierCard } from "@/app/(dashboard)/purchasing/supplier-card";
import { getSupplier } from "@/lib/purchasing/queries/suppliers";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleReadAccess("purchasing");
  const { id } = await params;
  const [supplier, addresses] = await Promise.all([
    getSupplier(id, { includeDeleted: true }),
    getAddressEntries(),
  ]);

  if (!supplier) {
    redirect("/purchasing/suppliers");
  }

  return (
    <SupplierCard
      initialSupplierId={id}
      initialSupplier={supplier}
      addresses={addresses}
    />
  );
}
