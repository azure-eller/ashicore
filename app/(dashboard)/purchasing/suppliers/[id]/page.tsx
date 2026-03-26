import { redirect } from "next/navigation";
import { SupplierDetail } from "@/app/(dashboard)/purchasing/supplier-detail";
import { getSupplier } from "@/app/(dashboard)/purchasing/queries";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supplier = await getSupplier(id, { includeDeleted: true });

  if (!supplier) {
    redirect("/purchasing/suppliers");
  }

  return <SupplierDetail supplier={supplier} />;
}
