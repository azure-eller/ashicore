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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, card, bomRows, bomRevisions, operationCosts, resources] = await Promise.all([
    getItem(id),
    getItemCard(id),
    getBomComponents(id),
    getBomRevisionHistory(id),
    getBomOperationCosts(id),
    getManufacturingResources(),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");
  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return (
    <ProductOperationsTab
      key={`${id}:${currentRevision?.id ?? "none"}`}
      card={card}
      focusItemId={id}
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
      expectedBatchYield={item.expectedBatchYield}
      typicalBatchSize={item.typicalBatchSize}
      standardCostQuantity={item.standardCostQuantity}
    />
  );
}
