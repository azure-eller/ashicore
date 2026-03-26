import { ManufacturingOrderForm } from "@/app/(dashboard)/manufacturing/manufacturing-order-form";
import {
  getManufacturingProductTemplates,
  getManufacturingSalesLineOptions,
} from "@/app/(dashboard)/manufacturing/queries";

export default async function NewManufacturingOrderPage() {
  const [products, salesLines] = await Promise.all([
    getManufacturingProductTemplates(),
    getManufacturingSalesLineOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ManufacturingOrderForm
        productTemplates={products}
        salesLineOptions={salesLines}
      />
    </div>
  );
}
