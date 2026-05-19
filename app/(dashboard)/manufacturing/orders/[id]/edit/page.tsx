import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAvailableComponents } from "@/app/(dashboard)/inventory/queries";
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

  const [ingredientItemOptions, salesLineOptions] = await Promise.all([
    getAvailableComponents(order.productId),
    getManufacturingSalesLineOptions(order.productId),
  ]);

  return (
    <ManufacturingOrderForm
      initialData={order}
      ingredientItemOptions={ingredientItemOptions}
      salesLineOptions={salesLineOptions}
    />
  );
}
