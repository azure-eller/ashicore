import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { inventoryLotBalances, lots, manufacturingOrderBatches, manufacturingOrders } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric } from "@/lib/format";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingExecutionDetail, ManufacturingExecutionQueueRow } from "../types";
import { type ExecutionBatchRow, getBatchIngredientsInTx, getBatchPickProgressStatus, getBatchRowsInTx, getCurrentExecutionBatch, getExecutionLotAllocationsByIngredientInTx, getExecutionLotPickPlansByIngredientInTx, getOutputQuantityInTx, getTemplateIngredientsInTx, toIngredientDetail, withIngredientLotTrackingModesInTx } from "./execution-state";
import { getManufacturingOrders } from "./orders-read";
import { canonicalItemName, getManufacturingItemDisplayMetadataInTx, getPickProgressStatus, getRemainingQuantityNumber } from "./shared";

export async function getManufacturingExecutionQueue(): Promise<
  ManufacturingExecutionQueueRow[]
> {
  const orders = await getManufacturingOrders();
  const batchOrderIds = orders
    .filter(
      (order) =>
        order.status === "open" &&
        order.manufacturingMode === "batch" &&
        (order.numberOfBatches ?? 0) > 0
    )
    .map((order) => order.id);
  const nextBatchIdByOrderId = new Map<string, string>();

  if (batchOrderIds.length > 0) {
    const batchRows = await withAuthedOrgContext((tx) =>
      tx
        .select({
          id: manufacturingOrderBatches.id,
          manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
          status: manufacturingOrderBatches.status,
          batchNumber: manufacturingOrderBatches.batchNumber,
        })
        .from(manufacturingOrderBatches)
        .where(inArray(manufacturingOrderBatches.manufacturingOrderId, batchOrderIds))
        .orderBy(
          asc(manufacturingOrderBatches.manufacturingOrderId),
          asc(manufacturingOrderBatches.batchNumber)
        )
    );

    for (const batch of batchRows) {
      if (batch.status === "completed" || nextBatchIdByOrderId.has(batch.manufacturingOrderId)) {
        continue;
      }

      nextBatchIdByOrderId.set(batch.manufacturingOrderId, batch.id);
    }
  }

  return orders
    .filter((order) => order.status === "open")
    .map((order) => {
      const totalBatchCount = order.numberOfBatches ?? 0;
      const nextBatchNumber =
        order.manufacturingMode === "batch" && totalBatchCount > 0
          ? Math.min(order.completedBatchCount + 1, totalBatchCount)
          : null;
      const nextBatchId =
        order.manufacturingMode === "batch"
          ? nextBatchIdByOrderId.get(order.id) ?? null
          : null;

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        productName: order.productName,
        productSku: order.productSku,
        productCategory: order.productCategory,
        itemSpriteKind: order.itemSpriteKind,
        itemSpriteColor: order.itemSpriteColor,
        priorityRank: order.priorityRank,
        plannedQuantity: order.plannedQuantity,
        actualQuantity: order.actualQuantity,
        unitName: order.unitName,
        plannedDate: order.plannedDate,
        manufacturingMode: order.manufacturingMode,
        pickProgressStatus: order.pickProgressStatus,
        nextBatchId,
        nextBatchNumber,
        completedBatchCount: order.completedBatchCount,
        totalBatchCount,
        actionLabel:
          order.manufacturingMode === "batch"
            ? nextBatchNumber == null
              ? "Continue"
              : `Batch ${nextBatchNumber}`
            : order.pickProgressStatus === "picked"
              ? "Complete"
              : "Pick",
      };
    });
}

export async function getManufacturingExecutionDetail(
  orderId: string
): Promise<ManufacturingExecutionDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productId: manufacturingOrders.productId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        unitName: manufacturingOrders.unitName,
        status: manufacturingOrders.status,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
          "actualQuantity"
        ),
        expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        numberOfBatches: manufacturingOrders.numberOfBatches,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        priorityRank: manufacturingOrders.priorityRank,
        plannedDate: manufacturingOrders.plannedDate,
        notes: manufacturingOrders.notes,
        bomRevisionId: manufacturingOrders.bomRevisionId,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, orderId), isNull(manufacturingOrders.deletedAt)))
      .for("update");

    if (!order) {
      return null;
    }

    let batches: ExecutionBatchRow[] = [];
    if (order.manufacturingMode === "batch") {
      batches = await getBatchRowsInTx(tx, orderId);
    }

    const currentBatch =
      order.manufacturingMode === "batch" ? getCurrentExecutionBatch(batches) : null;

    const ingredients =
      order.manufacturingMode === "batch" && currentBatch != null
        ? (await getBatchIngredientsInTx(tx, currentBatch.id)).map(toIngredientDetail)
        : (await getTemplateIngredientsInTx(tx, orderId)).map(toIngredientDetail);
    const lotAllocationsByIngredientId =
      await getExecutionLotAllocationsByIngredientInTx(
        tx,
        ingredients.map((ingredient) => ingredient.id)
      );
    const ingredientsWithLotAllocations = ingredients.map((ingredient) => ({
      ...ingredient,
      lotAllocations: lotAllocationsByIngredientId.get(ingredient.id) ?? [],
    }));
    const lotPickPlansByIngredientId =
      await getExecutionLotPickPlansByIngredientInTx(
        tx,
        orgId,
        ingredientsWithLotAllocations
      );
    const ingredientsWithLotGuidance = ingredientsWithLotAllocations.map(
      (ingredient) => ({
        ...ingredient,
        lotPickPlan: lotPickPlansByIngredientId.get(ingredient.id) ?? [],
      })
    );
    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(tx, [
      order.productId,
      ...ingredientsWithLotGuidance.map((ingredient) => ingredient.itemId),
    ]);
    const displayedIngredientsWithLotGuidance = await withIngredientLotTrackingModesInTx(
      tx,
      ingredientsWithLotGuidance.map((ingredient) => ({
        ...ingredient,
        itemName: canonicalItemName(
          itemDisplayById,
          ingredient.itemId,
          ingredient.itemName
        ),
      }))
    );
    const recordedOutputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: currentBatch?.id ?? null,
    });

    // Candidate lots the completion picker can merge a batch into (ERP-169).
    // Untracked finished goods use internal lots, so no lot choice is offered.
    const productLotTrackingMode = await getItemLotTrackingModeInTx(
      tx,
      order.productId
    );
    const availableProducedLots =
      productLotTrackingMode === "untracked"
        ? []
        : (
            await tx
              .select({
                lotId: inventoryLotBalances.lotId,
                lotNumber: lots.lotNumber,
                quantity: trimScale(
                  sql`SUM(${inventoryLotBalances.quantity})`
                ).as("quantity"),
              })
              .from(inventoryLotBalances)
              .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
              .where(
                and(
                  eq(inventoryLotBalances.organizationId, orgId),
                  eq(inventoryLotBalances.itemId, order.productId),
                  eq(inventoryLotBalances.disposition, "available"),
                  sql`${inventoryLotBalances.quantity} > 0`
                )
              )
              .groupBy(inventoryLotBalances.lotId, lots.lotNumber, lots.receivedAt)
              .orderBy(desc(lots.receivedAt))
              .limit(50)
          ).map((row) => ({
            lotId: row.lotId,
            lotNumber: row.lotNumber,
            quantity: row.quantity,
          }));

    return {
      ...order,
      productLotTrackingMode:
        productLotTrackingMode === "untracked" ? "untracked" : "tracked",
      availableProducedLots,
      productName: canonicalItemName(itemDisplayById, order.productId, order.productName),
      status: order.status as ManufacturingOrderStatus,
      pickProgressStatus:
        order.manufacturingMode === "batch"
          ? getBatchPickProgressStatus(batches)
          : getPickProgressStatus(
              displayedIngredientsWithLotGuidance.map((ingredient) => ({
                plannedQuantity: ingredient.plannedQuantity,
                pickedQuantity: ingredient.pickedQuantity,
              }))
            ),
      canComplete:
        order.status === "open" &&
        (recordedOutputQuantity > 0
          ? true
          : order.manufacturingMode === "batch"
            ? currentBatch != null &&
              displayedIngredientsWithLotGuidance.every(
                (ingredient) =>
                  getRemainingQuantityNumber(
                    ingredient.plannedQuantity,
                    ingredient.pickedQuantity
                  ) <= 0
              )
            : displayedIngredientsWithLotGuidance.every(
                (ingredient) =>
                  getRemainingQuantityNumber(
                    ingredient.plannedQuantity,
                    ingredient.pickedQuantity
                  ) <= 0
              )),
      currentBatchId: currentBatch?.id ?? null,
      currentBatch: currentBatch,
      batches,
      ingredients: displayedIngredientsWithLotGuidance,
      recordedOutputQuantity: normalizeNumeric(recordedOutputQuantity),
    };
  });
}
