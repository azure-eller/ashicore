import { Suspense } from "react";
import { SuppliersTable } from "@/app/(dashboard)/purchasing/suppliers-table";
import { getSuppliers } from "@/app/(dashboard)/purchasing/queries";
import DataTableSkeleton from "../data-table-skeleton";

export default function SuppliersPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <SuppliersData />
    </Suspense>
  );
}

async function SuppliersData() {
  const suppliers = await getSuppliers();
  return <SuppliersTable initialData={suppliers} />;
}
