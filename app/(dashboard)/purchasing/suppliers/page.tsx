import { SuppliersTable } from "@/app/(dashboard)/purchasing/suppliers-table";
import { getSuppliers } from "@/app/(dashboard)/purchasing/queries";

export default async function SuppliersPage() {
  const suppliers = await getSuppliers();
  return <SuppliersTable initialData={suppliers} />;
}
