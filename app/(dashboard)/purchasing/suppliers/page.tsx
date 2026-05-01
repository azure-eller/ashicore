import { Suspense } from "react";
import { SuppliersTable } from "@/app/(dashboard)/purchasing/suppliers-table";
import { getSuppliers } from "@/app/(dashboard)/purchasing/queries";
import DataTableLoading from "../data-table-loading";

export default function SuppliersPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <SuppliersData />
    </Suspense>
  );
}

async function SuppliersData() {
  const suppliers = await getSuppliers();
  return <SuppliersTable initialData={suppliers} />;
}
