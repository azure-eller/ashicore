import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { OrderForm } from "@/app/(dashboard)/sales/order-form";
import {
  getCustomers,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function NewOrderPage() {
  await requireModuleWriteAccess("sales");
  const [customerRows, items] = await Promise.all([
    getCustomers(),
    getSalesOrderItemOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <OrderForm
        customers={customerRows.map((customer) => ({
          id: customer.id,
          name: customer.name,
        }))}
        items={items}
      />
    </div>
  );
}
