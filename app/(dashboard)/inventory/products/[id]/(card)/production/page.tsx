import { redirect } from "next/navigation";
import {
  getBomComponents,
  getBomRevisionHistory,
  getBomOperationCosts,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductOperationsTab } from "../../tabs/operations";

export default async function ProductProductionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { variant } = await searchParams;
  const [item, card] = await Promise.all([
    getItem(id),
    getItemCard(id),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");
  const variantId = Array.isArray(variant) ? variant[0] : variant;
  const focusItemId =
    variantId &&
    card.variants.some(
      (cardVariant) => cardVariant.id === variantId && cardVariant.deletedAt == null,
    )
      ? variantId
      : id;
  const focusItem = focusItemId === id ? item : await getItem(focusItemId);
  if (!focusItem || focusItem.itemType !== "product") redirect("/inventory/products");

  const [bomRows, bomRevisions, operationCosts, resources] = await Promise.all([
    getBomComponents(focusItemId),
    getBomRevisionHistory(focusItemId),
    getBomOperationCosts(focusItemId),
    getManufacturingResources(),
  ]);
  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return (
    <ProductOperationsTab
      key={`${focusItemId}:${currentRevision?.id ?? "none"}`}
      focusItemId={focusItemId}
      currentBomOutputQuantity={currentRevision?.outputQuantity ?? "1"}
      currentRecipeBasis={currentRevision?.recipeBasis === "batch" ? "batch" : "unit"}
      currentBomRows={bomRows.map((row) => ({
          componentId: row.componentId,
          quantity: row.quantity,
          minimumLotAgeDays: row.minimumLotAgeDays ?? null,
          alternates: row.alternates.map((alternate) => ({
            itemId: alternate.itemId,
          })),
      }))}
      initialOperationCosts={operationCosts.map((operation) => ({
          operationName: operation.operationName,
          resourceId: operation.resourceId,
          costScalingMode: operation.costScalingMode,
          crewSize: operation.crewSize,
          plannedMinutes: operation.plannedMinutes,
          loadedCostPerHour: operation.loadedCostPerHour,
      }))}
      resources={resources}
      expectedBatchYield={focusItem.expectedBatchYield}
      typicalBatchSize={focusItem.typicalBatchSize}
      standardCostQuantity={focusItem.standardCostQuantity}
    />
  );
}
