import { redirect } from "next/navigation";
import { SupplierCard } from "@/app/(dashboard)/purchasing/supplier-card";
import { getSupplier } from "@/app/(dashboard)/purchasing/queries";
import { getAddressEntries } from "@/lib/dal/addresses";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
