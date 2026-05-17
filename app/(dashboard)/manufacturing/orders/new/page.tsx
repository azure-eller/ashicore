import { requireModuleAccess } from "@/lib/dal/auth";
import { getAvailableComponents } from "@/app/(dashboard)/inventory/queries";
import { ManufacturingOrderForm } from "@/app/(dashboard)/manufacturing/manufacturing-order-form";
import {
  getManufacturingProductTemplates,
  getManufacturingSalesLineOptions,
  getManufacturingSalesOrderOptions,
  getManufacturingSalesOrderPreview,
} from "@/app/(dashboard)/manufacturing/queries";

export default async function NewManufacturingOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ salesOrderId?: string }>;
}) {
  await requireModuleAccess("manufacturing", "operate");
  const { salesOrderId } = await searchParams;
  const [products, ingredientItems, salesLines, salesOrders, initialPreview] = await Promise.all([
    getManufacturingProductTemplates(),
    getAvailableComponents(),
    getManufacturingSalesLineOptions(),
    getManufacturingSalesOrderOptions(),
    salesOrderId ? getManufacturingSalesOrderPreview(salesOrderId) : Promise.resolve(null),
  ]);

  return (
    <ManufacturingOrderForm
      productTemplates={products}
      ingredientItemOptions={ingredientItems}
      salesLineOptions={salesLines}
      salesOrderOptions={salesOrders}
      initialSalesOrderId={salesOrderId ?? null}
      initialSalesOrderPreview={initialPreview}
    />
  );
}
