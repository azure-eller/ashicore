import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { inventoryExpectedSummary, manufacturingOrderBatches, manufacturingOrderIngredients, manufacturingOrders, manufacturingPickAllocations } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeNumericScale, normalizeQuantityNumber } from "@/lib/format";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import type { Tx } from "@/lib/db/with-org-context";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { applyExpectedReferenceDeltasInTx, beginInventoryOperationInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, getDefaultInventoryLocationInTx, produceManufacturedStockInTx, reconcileIngredientActualsInTx, releaseIngredientDemandForManufacturingInTx } from "@/lib/inventory/kernel";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import type { CompleteManufacturingBatch, CompleteManufacturingOrder } from "@/lib/schemas/manufacturing-orders";
import { ManufacturingError } from "./errors";
import { assertCurrentExecutionBatch, ensureBatchExecutionRowsInTx, getBatchIngredientsInTx, getBatchRowsInTx, getCurrentExecutionBatch, getLockedBatchStateRowsInTx, getOutputQuantityInTx, getPickAllocationsByIngredientInTx, getProducedLotIdInTx, resolveProducedLotForUnitInTx } from "./execution-state";
import { assertLinkedMtoOutputWithinSalesDemandInTx, buildOutputConsumptionsFromPickedAllocations, getAbsorbedOperationCostForQuantityInTx, getIncrementalAbsorbedOperationCostForQuantityInTx, getTotalOutputQuantityForOrderInTx, insertManufacturingOrderOutputInTx } from "./output";
import { getLockedManufacturingOrderInTx, getRemainingQuantityNumber, isOpenManufacturingOrder, rerankOpenManufacturingOrdersInTx, sumNumericStrings, validateActiveIngredientItemsInTx } from "./shared";

export function buildIngredientActualsMap(
  submitted: CompleteManufacturingOrder["ingredientActuals"] | undefined,
  ingredientRows: Array<{ id: string; itemName: string }>
) {
  const map = new Map<string, number>();
  if (!submitted || submitted.length === 0) {
    return map;
  }

  const ingredientIds = new Set(ingredientRows.map((row) => row.id));
  for (const entry of submitted) {
    if (!ingredientIds.has(entry.ingredientId)) {
      throw new ManufacturingError(
        "Unknown ingredient in actuals payload.",
        400,
        { errors: { ingredientActuals: ["Unknown ingredient."] } }
      );
    }
    map.set(entry.ingredientId, parseFloat(entry.actualConsumedQuantity));
  }

  const missing = ingredientRows.filter((ingredient) => !map.has(ingredient.id));
  if (missing.length > 0) {
    throw new ManufacturingError(
      `Missing actuals for ${missing.map((ingredient) => ingredient.itemName).join(", ")}.`,
      400,
      {
        errors: {
          ingredientActuals: missing.map((ingredient) => ingredient.itemName),
        },
      }
    );
  }

  return map;
}

export async function getPickAllocationTotalsInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, { quantity: number; cost: number }>();
  }

  const rows = await tx
    .select({
      manufacturingOrderIngredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      quantityUsed: trimScale(manufacturingPickAllocations.quantityUsed).as("quantityUsed"),
      costPerUnit: trimScaleNullable(manufacturingPickAllocations.costPerUnit).as(
        "costPerUnit"
      ),
    })
    .from(manufacturingPickAllocations)
    .where(
      inArray(manufacturingPickAllocations.manufacturingOrderIngredientId, uniqueIds)
    );

  const totals = new Map<string, { quantity: number; cost: number }>();

  for (const row of rows) {
    const current = totals.get(row.manufacturingOrderIngredientId) ?? {
      quantity: 0,
      cost: 0,
    };
    const quantity = parseFloat(row.quantityUsed);
    const costPerUnit = row.costPerUnit != null ? parseFloat(row.costPerUnit) : 0;
    current.quantity += quantity;
    current.cost += quantity * costPerUnit;
    totals.set(row.manufacturingOrderIngredientId, current);
  }

  return totals;
}

export async function releaseRemainingExpectedOutputInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    actorUserId?: string | null;
    quantity?: number | null;
  }
) {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const expectedRows = await tx
    .select({
      itemId: inventoryExpectedSummary.itemId,
      quantity: inventoryExpectedSummary.quantity,
    })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, params.organizationId),
        eq(inventoryExpectedSummary.locationId, location.id),
        eq(inventoryExpectedSummary.referenceType, "manufacturing_order"),
        eq(inventoryExpectedSummary.referenceId, params.manufacturingOrderId)
      )
    );

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "completed",
    deltas: expectedRows
      .map((row) => {
        const currentOpenQty = parseFloat(row.quantity);
        const releaseQty =
          params.quantity == null ? currentOpenQty : Math.min(currentOpenQty, params.quantity);
        return releaseQty > 0
          ? {
              itemId: row.itemId,
              referenceType: "manufacturing_order",
              referenceId: params.manufacturingOrderId,
              quantity: -releaseQty,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row != null),
  });
}

export async function startManufacturingBatch(
  orderId: string,
  batchId: string
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order) || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only open batch-mode orders can start batches", 400);
    }

    await ensureBatchExecutionRowsInTx(tx, order);
    const batches = await getLockedBatchStateRowsInTx(tx, orderId);
    const batch = batches.find((row) => row.id === batchId);

    if (!batch) {
      throw new ManufacturingError("Batch not found", 404);
    }

    assertCurrentExecutionBatch(batches, batchId, "started");

    if (batch.status === "pending") {
      await tx
        .update(manufacturingOrderBatches)
        .set({
          status: "in_progress",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batchId));
    }

    return { id: batchId };
  });
}

export async function startManufacturingOrderWork(
  orderId: string
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can start work", 400);
    }

    const now = new Date();
    await tx
      .update(manufacturingOrders)
      .set({
        isBlocked: false,
        startedAt: order.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(manufacturingOrders.id, orderId));

    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      const batches = await getLockedBatchStateRowsInTx(tx, orderId);
      const batch = getCurrentExecutionBatch(batches);

      if (!batch) {
        throw new ManufacturingError("All batches are already completed", 400);
      }

      if (batch.status === "pending") {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            status: "in_progress",
            startedAt: now,
            updatedAt: now,
          })
          .where(eq(manufacturingOrderBatches.id, batch.id));
      }
    }

    return { id: orderId };
  });
}

export async function completeManufacturingBatch(
  orderId: string,
  batchId: string,
  payload: CompleteManufacturingBatch,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "completeManufacturingBatch",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, batchId, payload },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order) || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only open batch-mode orders can complete batches", 400);
    }

    await ensureBatchExecutionRowsInTx(tx, order);
    const batches = await getLockedBatchStateRowsInTx(tx, orderId);
    const batch = batches.find((row) => row.id === batchId);

    if (!batch) {
      throw new ManufacturingError("Batch not found", 404);
    }

    assertCurrentExecutionBatch(batches, batchId, "completed");
    const completesOrder = batches.every(
      (currentBatch) => currentBatch.id === batchId || currentBatch.status === "completed"
    );

    const outputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batchId,
    });
    if (outputQuantity > 0) {
      if (payload.actualQuantity != null) {
        throw new ManufacturingError(
          "Output is already recorded for this batch.",
          400
        );
      }

      const plannedBatchQuantity = parseFloat(
        (
          await tx
            .select({
              plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
                "plannedQuantity"
              ),
            })
            .from(manufacturingOrderBatches)
            .where(eq(manufacturingOrderBatches.id, batchId))
        )[0]?.plannedQuantity ?? "0"
      );
      const ingredientRows = await getBatchIngredientsInTx(tx, batchId);
      await releaseIngredientDemandForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: orderId,
        actorUserId: userId,
        reason: "completed",
        ingredientIds: ingredientRows.map((row) => row.id),
      });
      if (!completesOrder) {
        await releaseRemainingExpectedOutputInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: orderId,
          actorUserId: userId,
          quantity: Math.max(0, plannedBatchQuantity - outputQuantity),
        });
      } else {
        await releaseRemainingExpectedOutputInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: orderId,
          actorUserId: userId,
        });
      }

      const producedLotId = await getProducedLotIdInTx(tx, orderId, batchId);
      await tx
        .update(manufacturingOrderBatches)
        .set({
          status: "completed",
          actualQuantity: normalizeNumeric(outputQuantity),
          lotId: producedLotId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batchId));

      const updatedBatches = await getBatchRowsInTx(tx, orderId);
      const completedBatchCount = updatedBatches.filter(
        (currentBatch) => currentBatch.status === "completed"
      ).length;
      const allCompleted =
        updatedBatches.length > 0 && completedBatchCount === updatedBatches.length;
      await tx
        .update(manufacturingOrders)
        .set({
          status: allCompleted ? "done" : "open",
          priorityRank: allCompleted ? null : order.priorityRank,
          completedAt: allCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, orderId));

      if (allCompleted) {
        await rerankOpenManufacturingOrdersInTx(tx, orgId);
      }

      const result = { id: batchId };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });

      return result;
    }

    const ingredientRows = await getBatchIngredientsInTx(tx, batchId);
    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.itemId)
    );

    const unpickedIngredients = ingredientRows.filter(
      (ingredient) => getRemainingQuantityNumber(ingredient.plannedQuantity, ingredient.pickedQuantity) > 0
    );

    if (unpickedIngredients.length > 0) {
      throw new ManufacturingError(
        "Pick all batch ingredients before completing the batch.",
        400,
        {
          shortage: {
            ingredients: unpickedIngredients.map((ingredient) => ({
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              unitName: ingredient.unitName,
              needed: parseFloat(ingredient.plannedQuantity),
              available: parseFloat(ingredient.pickedQuantity),
              shortage: getRemainingQuantityNumber(
                ingredient.plannedQuantity,
                ingredient.pickedQuantity
              ),
            })),
          },
        }
      );
    }

    if (payload.actualQuantity == null) {
      throw new ManufacturingError("Actual quantity is required.", 400);
    }

    // Producing into a non-available disposition creates a blocked lot — the
    // lot_tracking paid state. Completing as available is always free.
    if (payload.outputDisposition !== "available") {
      await assertFeatureAccessInTx(tx, orgId, "lot_tracking", {
        route: "POST /api/manufacturing-orders/[id]/complete",
      });
    }

    const actualQuantity = Number(payload.actualQuantity);
    await assertLinkedMtoOutputWithinSalesDemandInTx(
      tx,
      order,
      actualQuantity
    );
    const allocationTotals = await getPickAllocationTotalsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.id)
    );

    const actualsMap = buildIngredientActualsMap(
      payload.ingredientActuals,
      ingredientRows
    );

    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const pickedQty = parseFloat(ingredient.pickedQuantity);
      const suppliedActual = actualsMap.get(ingredient.id);
      let effectiveQuantity: number;
      let effectiveCost: number;

      if (suppliedActual != null) {
        let reconciled: Awaited<ReturnType<typeof reconcileIngredientActualsInTx>>;
        try {
          reconciled = await reconcileIngredientActualsInTx(tx, {
            organizationId: orgId,
            locationId: payload.locationId,
            ingredient: {
              id: ingredient.id,
              itemId: ingredient.itemId,
              pickedQuantity: pickedQty,
            },
            actualConsumedQuantity: suppliedActual,
            referenceType: "manufacturing_batch",
            referenceId: batchId,
            actorUserId: userId,
            idempotencyKey: deriveInventoryIdempotencyKey(
              options?.idempotencyKey,
              `batch-variance:${batchId}:${ingredient.id}`
            ),
            allowNegativeStock: payload.confirmNegativeStock === true,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
              shortage: {
                ingredients: [
                  {
                    itemId: ingredient.itemId,
                    itemName: ingredient.itemName,
                    unitName: ingredient.unitName,
                    needed: error.requested,
                    available: error.available,
                    shortage: normalizeQuantityNumber(error.requested - error.available),
                    warningType: "stock_shortage",
                  },
                ],
              },
            });
          }
          throw error;
        }
        effectiveQuantity = reconciled.newTotalQuantity;
        effectiveCost = reconciled.newTotalCost;
      } else {
        const totals = allocationTotals.get(ingredient.id) ?? { quantity: 0, cost: 0 };
        effectiveQuantity = pickedQty;
        effectiveCost = totals.cost;
      }

      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeNumeric(effectiveQuantity),
          actualCostTotal: normalizeNumeric(effectiveCost),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));

      produceIngredientRows.push({
        ingredientId: ingredient.id,
        actualQuantity: effectiveQuantity,
        actualCostTotal: effectiveCost,
      });
    }

    const existingOrderOutputQuantity = await getTotalOutputQuantityForOrderInTx(
      tx,
      orderId
    );
    const absorbedOperationCost = await getIncrementalAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      existingOrderOutputQuantity,
      actualQuantity,
      { absorbFullFixedCost: completesOrder }
    );
    const targetLot = await resolveProducedLotForUnitInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batchId,
      productId: order.productId,
      selection: payload,
    });
    const produced = await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      productId: order.productId,
      quantity: actualQuantity,
      locationId: payload.locationId,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      lotId: targetLot.lotId,
      newLotNumber: targetLot.newLotNumber,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        `complete-batch:${batchId}`
      ),
      expectedReleaseQuantity: completesOrder ? null : actualQuantity,
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });

    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      produceIngredientRows.map((ingredient) => ingredient.ingredientId)
    );
    const outputConsumptionRows = buildOutputConsumptionsFromPickedAllocations(
      produceIngredientRows,
      pickAllocationsByIngredient
    );
    const materialCostTotal = produceIngredientRows.reduce(
      (sum, ingredient) => sum + ingredient.actualCostTotal,
      0
    );

    await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batchId,
      lotId: produced.lotId,
      locationId: produced.locationId,
      quantity: actualQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal,
      notes: null,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
    });

    await tx
      .update(manufacturingOrderBatches)
      .set({
        status: "completed",
        actualQuantity: normalizeNumeric(actualQuantity),
        pickedAt: batch.pickedAt ?? new Date(),
        completedAt: new Date(),
        lotId: produced.lotId,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderBatches.id, batchId));

    const updatedBatches = await getBatchRowsInTx(tx, orderId);
    const totalActualQuantity = sumNumericStrings(
      updatedBatches.map((currentBatch) => currentBatch.actualQuantity)
    );
    const completedBatchCount = updatedBatches.filter(
      (currentBatch) => currentBatch.status === "completed"
    ).length;
    const allCompleted = updatedBatches.length > 0 && completedBatchCount === updatedBatches.length;

    const batchIngredientRows = await tx
      .select({
        actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
          "actualCostTotal"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));

    const totalMaterialCost = sumNumericStrings(
      batchIngredientRows.map((row) => row.actualCostTotal)
    );
    const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      totalActualQuantity,
      { absorbFullFixedCost: allCompleted }
    );

    await tx
      .update(manufacturingOrders)
      .set({
        actualQuantity: normalizeNumeric(totalActualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualOperationsCost: normalizeNumericScale(totalOperationsCost, 6),
        actualCostPerUnit:
          totalActualQuantity > 0
            ? normalizeNumeric((totalMaterialCost + totalOperationsCost) / totalActualQuantity)
            : normalizeNumeric(0),
        status: allCompleted ? "done" : "open",
        priorityRank: allCompleted ? null : order.priorityRank,
        completedAt: allCompleted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, orderId));

    if (allCompleted) {
      await rerankOpenManufacturingOrdersInTx(tx, orgId);
    }

    const result = { id: batchId };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
