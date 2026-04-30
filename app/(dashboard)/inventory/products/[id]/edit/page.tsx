import { redirect } from "next/navigation";
import { getAuthedMemberContext, requireModuleAccess } from "@/lib/dal/auth";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
  getBomComponents,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";
import { hasModuleAccess } from "@/lib/authz";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleAccess("inventory", "operate");
  const { id } = await params;
  const context = await getAuthedMemberContext();
  const [item, units, categories, bom, components] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
    getBomComponents(id),
    getAvailableComponents(id),
  ]);
  if (!item) redirect("/inventory/products");
  if (item.isMaster) redirect(`/inventory/products/${id}`);
  if (item.bomLocked && !hasModuleAccess(context.assignedRoles, "inventory", "admin")) {
    redirect(`/inventory/products/${id}`);
  }

  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <ItemForm
        itemType="product"
        units={units}
        categories={categories}
        availableComponents={components}
        canManageBomLock={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
        initialData={{
          ...item,
          bom: bom.map((b) => ({
            componentId: b.componentId,
            quantity: b.quantity,
            minimumLotAgeDays: b.minimumLotAgeDays,
          })),
        }}
      />
    </div>
  );
}
