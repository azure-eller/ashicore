import { redirect } from "next/navigation";
import { getAuthedMemberContext, requireModuleAccess } from "@/lib/dal/auth";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
  getBomComponents,
  getBomOperationCosts,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";
import { hasModuleAccess } from "@/lib/authz";
import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleAccess("inventory", "operate");
  const { id } = await params;
  const context = await getAuthedMemberContext();
  const [item, units, categories, bom, operationCosts, components, resources] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
    getBomComponents(id),
    getBomOperationCosts(id),
    getAvailableComponents(id),
    getManufacturingResources(),
  ]);
  if (!item) redirect("/inventory/products");
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
        manufacturingResources={resources}
        canManageBomLock={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
        initialData={{
          ...item,
          bom: bom.map((b) => ({
            componentId: b.componentId,
            quantity: b.quantity,
            minimumLotAgeDays: b.minimumLotAgeDays,
            alternates: b.alternates.map((alternate) => ({
              itemId: alternate.itemId,
            })),
          })),
          operationCosts: operationCosts.map((operation) => ({
            operationName: operation.operationName,
            resourceId: operation.resourceId,
            costScalingMode: operation.costScalingMode,
            crewSize: operation.crewSize,
            plannedMinutes: operation.plannedMinutes,
            loadedCostPerHour: operation.loadedCostPerHour,
          })),
        }}
      />
    </div>
  );
}
