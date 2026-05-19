import { redirect } from "next/navigation";
import {
  getAvailableComponents,
  getBomComponents,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductCardShell } from "../card-shell";
import { ProductRecipeTab } from "../tabs/recipe";

export default async function ProductRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [context, item, card] = await Promise.all([
    getAuthedMemberContext(),
    getItem(id),
    getItemCard(id),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const [bomRows, availableComponents] = await Promise.all([
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
    getAvailableComponents(id),
  ]);

  return (
    <ProductCardShell itemId={id} activeTab="recipe">
      <ProductRecipeTab
        card={card}
        focusItemId={id}
        initialBomRows={bomRows.map((row) => ({
          componentId: row.componentId,
          quantity: row.quantity,
          consumptionMode:
            (row.consumptionMode as
              | "per_output_unit"
              | "per_batch"
              | "per_group"
              | null) ?? null,
          basisOutputQuantity: row.basisOutputQuantity ?? null,
          batchScalingMode:
            (row.batchScalingMode as
              | "proportional"
              | "full_batches_only"
              | null) ?? null,
          groupRemainderPolicy:
            (row.groupRemainderPolicy as
              | "ask"
              | "leave_loose"
              | "create_partial_group"
              | null) ?? null,
          minimumLotAgeDays: row.minimumLotAgeDays ?? null,
          alternates: row.alternates.map((alternate) => ({
            itemId: alternate.itemId,
          })),
        }))}
        availableComponents={availableComponents.map((component) => ({
          id: component.id,
          name: component.name,
          displayName: component.displayName,
          itemType: component.itemType,
          unit: component.unit,
        }))}
        canViewBom={canViewBom}
      />
    </ProductCardShell>
  );
}
