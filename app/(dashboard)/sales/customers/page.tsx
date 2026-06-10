import { Suspense } from "react";
import { CustomersTable } from "@/app/(dashboard)/sales/customers-table";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { todayInTimeZone } from "@/lib/format";
import { getCustomers } from "@/lib/sales/queries/customers-read";
import DataTableLoading from "../data-table-loading";

export default function CustomersPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <CustomersData />
    </Suspense>
  );
}

async function CustomersData() {
  const context = await requireModuleReadAccess("sales");
  const customers = await getCustomers();
  return (
    <CustomersTable
      initialData={customers}
      today={todayInTimeZone(context.organizationTimeZone)}
    />
  );
}
