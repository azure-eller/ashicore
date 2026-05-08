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
    <div className="mx-auto w-full max-w-7xl py-8">
      <OrderForm
        initialData={order}
        customers={customerRows.map((customer) => ({
          id: customer.id,
          name: customer.name,
          billingLine1: customer.billingLine1,
          billingLine2: customer.billingLine2,
          billingCity: customer.billingCity,
          billingRegion: customer.billingRegion,
          billingPostcode: customer.billingPostcode,
          billingCountry: customer.billingCountry,
          shipLine1: customer.shipLine1,
          shipLine2: customer.shipLine2,
          shipCity: customer.shipCity,
          shipRegion: customer.shipRegion,
          shipPostcode: customer.shipPostcode,
          shipCountry: customer.shipCountry,
        }))}
        items={items}
      />
    </div>
  );
}
