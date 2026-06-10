import { NextResponse } from "next/server";
import { getBomComponents, getBomOperationCosts, getBomRevisionHistory } from "@/lib/inventory/queries/bom-read";
import { getItem } from "@/lib/inventory/queries/item-detail";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await ((ctx as RouteContext).params as Promise<{ id: string }>);
  const [item, bomRows, bomRevisions, operationCosts, resources] = await Promise.all([
    getItem(id),
    getBomComponents(id),
    getBomRevisionHistory(id),
    getBomOperationCosts(id),
    getManufacturingResources(),
  ]);

  if (!item || item.itemType !== "product") {
    return jsonNotFound("Product variant not found");
  }

  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return NextResponse.json({
    focusItemId: id,
    currentBomOutputQuantity: currentRevision?.outputQuantity ?? "1",
    currentRecipeBasis: currentRevision?.recipeBasis === "batch" ? "batch" : "unit",
    currentBomRows: bomRows.map((row) => ({
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: row.minimumLotAgeDays ?? null,
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.itemId,
      })),
    })),
    initialOperationCosts: operationCosts.map((operation) => ({
      operationName: operation.operationName,
      resourceId: operation.resourceId,
      costScalingMode: "per_output_unit",
      crewSize: operation.crewSize,
      plannedMinutes: operation.plannedMinutes,
      loadedCostPerHour: operation.loadedCostPerHour,
    })),
    resources,
    expectedBatchYield: item.expectedBatchYield,
    typicalBatchSize: item.typicalBatchSize,
    standardCostQuantity: item.standardCostQuantity,
  });
});
