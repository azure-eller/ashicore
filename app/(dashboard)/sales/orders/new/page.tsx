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
