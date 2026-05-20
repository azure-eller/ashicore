import { requireModuleAccess } from "@/lib/dal/auth";
import { getAvailableComponents } from "@/app/(dashboard)/inventory/queries";
import { ManufacturingOrderForm } from "@/app/(dashboard)/manufacturing/manufacturing-order-form";
import {
  getManufacturingProductTemplates,
  getManufacturingSalesLineOptions,
  getManufacturingSalesOrderOptions,
  getManufacturingSalesOrderPreview,
} from "@/app/(dashboard)/manufacturing/queries";

/**
 * Draft MO entry point — mirrors `/inventory/product` (singular). On first
 * successful save the form routes to `/manufacturing/orders/{id}` which
 * renders the redesigned sheet for further inline editing.
 */
export default async function ManufacturingOrderDraftPage({
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
