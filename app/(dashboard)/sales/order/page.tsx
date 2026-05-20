import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";
import { OrderCard } from "@/app/(dashboard)/sales/orders/[id]/order-card";

export default async function NewSalesOrderPage() {
  await requireModuleWriteAccess("sales");
  const [customerOptions, itemOptions] = await Promise.all([
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
  ]);

  return (
    <OrderCard
      initialOrder={null}
      customerOptions={customerOptions}
      itemOptions={itemOptions}
    />
  );
}
