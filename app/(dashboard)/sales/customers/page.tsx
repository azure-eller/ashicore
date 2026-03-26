import { CustomersTable } from "@/app/(dashboard)/sales/customers-table";
import { getCustomers } from "@/app/(dashboard)/sales/queries";

export default async function CustomersPage() {
  const customers = await getCustomers();
  return <CustomersTable initialData={customers} />;
}
