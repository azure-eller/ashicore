import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";
import { getAddressEntries } from "@/lib/dal/addresses";
import { OrderCard } from "@/app/(dashboard)/sales/orders/[id]/order-card";

export default async function NewSalesOrderPage() {
  await requireModuleWriteAccess("sales");
  const [customerOptions, itemOptions, addressOptions] = await Promise.all([
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
    getAddressEntries(),
  ]);

  return (
    <OrderCard
      initialOrder={null}
      customerOptions={customerOptions}
      itemOptions={itemOptions}
      addressOptions={addressOptions}
    />
  );
}
