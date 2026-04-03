import { redirect } from "next/navigation";
import { OrderForm } from "@/app/(dashboard)/sales/order-form";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getCustomers,
  getEditableSalesOrder,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const { id } = await params;
  const [order, customerRows, items] = await Promise.all([
    getEditableSalesOrder(id),
    getCustomers(),
    getSalesOrderItemOptions(),
  ]);

  if (!order) {
    redirect("/sales/orders");
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <OrderForm
        initialData={order}
        customers={customerRows.map((customer) => ({
          id: customer.id,
          name: customer.name,
        }))}
        items={items}
      />
    </div>
  );
}
