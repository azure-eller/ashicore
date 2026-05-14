import { redirect } from "next/navigation";
import { OrderForm } from "@/app/(dashboard)/sales/order-form";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getEditableSalesOrder,
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const { id } = await params;
  const [order, customerRows, items, addresses] = await Promise.all([
    getEditableSalesOrder(id),
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
    getAddressEntries(),
  ]);

  if (!order) {
    redirect("/sales/orders");
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] py-8">
      <OrderForm
        initialData={order}
        customers={customerRows}
        items={items}
        addresses={addresses}
      />
    </div>
  );
}
