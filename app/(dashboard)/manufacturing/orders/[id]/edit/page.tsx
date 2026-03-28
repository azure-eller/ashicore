import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
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
  await requireModuleWriteAccess("manufacturing");
  const { id } = await params;
  const order = await getManufacturingOrderEditData(id);

  if (!order) {
    redirect("/manufacturing/orders");
  }

  const salesLineOptions = await getManufacturingSalesLineOptions(order.productId);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ManufacturingOrderForm
        initialData={order}
        salesLineOptions={salesLineOptions}
      />
    </div>
  );
}
