import { redirect } from "next/navigation";
import {
  getBomComponents,
  getBomOperationCosts,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductCardShell } from "../card-shell";
import { ProductOperationsTab } from "../tabs/operations";

export default async function ProductProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, card, bomRows, operationCosts, resources] = await Promise.all([
    getItem(id),
    getItemCard(id),
    getBomComponents(id),
    getBomOperationCosts(id),
    getManufacturingResources(),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");

  return (
    <ProductCardShell itemId={id} activeTab="production">
      <ProductOperationsTab
        card={card}
        focusItemId={id}
        currentBomRows={bomRows.map((row) => ({
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
    </ProductCardShell>
  );
}
