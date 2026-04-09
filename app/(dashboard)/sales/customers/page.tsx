import { Suspense } from "react";
import { CustomersTable } from "@/app/(dashboard)/sales/customers-table";
import { getCustomers } from "@/app/(dashboard)/sales/queries";
import DataTableSkeleton from "../data-table-skeleton";

export default function CustomersPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <CustomersData />
    </Suspense>
  );
}

async function CustomersData() {
  const customers = await getCustomers();
  return <CustomersTable initialData={customers} />;
}
