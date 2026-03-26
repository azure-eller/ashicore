import { redirect } from "next/navigation";
import { ManufacturingOrderForm } from "@/app/(dashboard)/manufacturing/manufacturing-order-form";
import {
  getManufacturingOrderEditData,
  getManufacturingSalesLineOptions,
} from "@/app/(dashboard)/manufacturing/queries";

export default async function EditManufacturingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, salesLines] = await Promise.all([
    getManufacturingOrderEditData(id),
    getManufacturingSalesLineOptions(),
  ]);

  if (!order) {
    redirect("/manufacturing/orders");
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ManufacturingOrderForm
        initialData={order}
        salesLineOptions={salesLines}
      />
    </div>
  );
}
