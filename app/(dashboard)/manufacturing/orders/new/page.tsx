import { ManufacturingOrderForm } from "@/app/(dashboard)/manufacturing/manufacturing-order-form";
import {
  getManufacturingProductTemplates,
  getManufacturingSalesOrderOptions,
  getManufacturingSalesOrderPreview,
} from "@/app/(dashboard)/manufacturing/queries";

export default async function NewManufacturingOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ salesOrderId?: string }>;
}) {
  const { salesOrderId } = await searchParams;
  const [products, salesOrders, initialPreview] = await Promise.all([
    getManufacturingProductTemplates(),
    getManufacturingSalesOrderOptions(),
    salesOrderId ? getManufacturingSalesOrderPreview(salesOrderId) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ManufacturingOrderForm
        productTemplates={products}
        salesOrderOptions={salesOrders}
        initialSalesOrderId={salesOrderId ?? null}
        initialSalesOrderPreview={initialPreview}
      />
    </div>
  );
}
