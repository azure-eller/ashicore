import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { inventoryLotBalances, manufacturingOrderIngredients, manufacturingOrders, organization } from "@/lib/db/schema";
import { normalizeNumeric, normalizeNumericScale, normalizeQuantityNumber, todayInTimeZone } from "@/lib/format";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { beginInventoryOperationInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, getManufacturingIngredientDemandRowsInTx, produceManufacturedStockInTx, reconcileIngredientActualsInTx, releaseIngredientDemandForManufacturingInTx, resolveInventoryLocationInTx } from "@/lib/inventory/kernel";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { evaluateLotAgeMinDaysRequirement, formatMinimumLotAgeRequirementViolation, getMinimumLotAgeDays, LOT_AGE_MIN_DAYS_CONSTRAINT } from "@/lib/bom/constraints";
import { notifyManufacturingOrderCompleted } from "@/lib/notifications/manufacturing";
import type { CompleteManufacturingOrder } from "@/lib/schemas/manufacturing-orders";
import { buildIngredientActualsMap, completeManufacturingBatch, getPickAllocationTotalsInTx, releaseRemainingExpectedOutputInTx } from "./batches";
import { ManufacturingError } from "./errors";
import { getManufacturingExecutionDetail } from "./execution-read";
import { getOutputQuantityInTx, getPickAllocationsByIngredientInTx, getTemplateIngredientsInTx, resolveProducedLotForUnitInTx } from "./execution-state";
import { assertLinkedMtoOutputWithinSalesDemandInTx, buildOutputConsumptionsFromPickedAllocations, getAbsorbedOperationCostForQuantityInTx, insertManufacturingOrderOutputInTx, recordManufacturingOutput } from "./output";
import { getLockedManufacturingOrderInTx, isOpenManufacturingOrder, rerankOpenManufacturingOrdersInTx, validateActiveIngredientItemsInTx } from "./shared";

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function subtractDays(value: string, days: number) {
  return addDays(value, -days);
}

async function getOrganizationTodayInTx(tx: Parameters<typeof resolveInventoryLocationInTx>[0], organizationId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? "America/Denver");
}

async function getLotAgeAvailabilityInTx(
  tx: Parameters<typeof resolveInventoryLocationInTx>[0],
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    minimumLotAgeDays: number;
    requiredDate: string;
  }
) {
  const cutoffReceivedDate = subtractDays(
    params.requiredDate,
    params.minimumLotAgeDays
  );
  const rows = await tx
    .select({
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));

  let eligible = 0;
  let nextEligibleDate: string | null = null;

  for (const row of rows) {
    const quantity = parseFloat(row.quantity);
    const receivedDate = isoDate(row.receivedAt);
    const eligibleDate = addDays(receivedDate, params.minimumLotAgeDays);
    if (receivedDate <= cutoffReceivedDate) {
      eligible += quantity;
      continue;
    }

    if (nextEligibleDate == null || eligibleDate < nextEligibleDate) {
      nextEligibleDate = eligibleDate;
    }
  }

  return { eligible, nextEligibleDate };
}

async function getManufacturingOrderCompletionTarget(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        manufacturingMode: manufacturingOrders.manufacturingMode,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)));

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    return order;
  });
}

async function notifyIfManufacturingOrderJustCompleted(result: {
  id: string;
  completedOrder: boolean;
  orgId: string | null;
}) {
  if (result.completedOrder && result.orgId) {
    await notifyManufacturingOrderCompleted(result.orgId, result.id);
  }
}

async function completeBatchModeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  if (payload.actualQuantity != null) {
    throw new ManufacturingError(
      "Batch-mode order completion uses each remaining batch's planned quantity.",
      400
    );
  }

  const requestedBatchCount = payload.batchCount ?? null;
  let completedBatchCount = 0;

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    if (requestedBatchCount != null && completedBatchCount >= requestedBatchCount) {
      return { id };
    }

    const execution = await getManufacturingExecutionDetail(id);

    if (!execution) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (execution.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only batch-mode orders can be batch completed.", 400);
    }

    if (execution.status === "done") {
      if (requestedBatchCount != null && completedBatchCount < requestedBatchCount) {
        throw new ManufacturingError("There are fewer remaining batches than requested.", 400);
      }
      return { id };
    }

    if (execution.status !== "open") {
      throw new ManufacturingError("Only open orders can be completed", 400);
    }

    const batch =
      execution.currentBatch ??
      execution.batches.find((currentBatch) => currentBatch.status !== "completed");

    if (!batch) {
      if (requestedBatchCount != null && completedBatchCount < requestedBatchCount) {
        throw new ManufacturingError("There are fewer remaining batches than requested.", 400);
      }
      return { id };
    }

    const plannedQuantity = Number(batch.plannedQuantity);
    if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
      throw new ManufacturingError("Planned batch quantity is invalid.", 400);
    }

    const existingOutputQuantity = Number(batch.actualQuantity ?? "0");
    const remainingOutputQuantity = normalizeQuantityNumber(
      plannedQuantity - existingOutputQuantity
    );

    // A produced-lot choice on the order-level /complete applies to the single batch
    // being completed; if several batches are closed in one call, only the first takes
    // it (a shared name would clash) and the rest get their own auto lots.
    const lotForThisBatch = completedBatchCount === 0;
    const batchProducedLotId = lotForThisBatch ? payload.producedLotId : undefined;
    const batchProducedLotNumber = lotForThisBatch ? payload.producedLotNumber : null;

    if (remainingOutputQuantity > 0) {
      await recordManufacturingOutput(
        id,
        {
          locationId: payload.locationId,
          quantity: normalizeNumeric(remainingOutputQuantity),
          outputDisposition: payload.outputDisposition,
          notes: null,
          confirmNegativeStock: payload.confirmNegativeStock,
          producedLotId: batchProducedLotId,
          producedLotNumber: batchProducedLotNumber,
        },
        {
          batchId: batch.id,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            `batch-output:${batch.id}`
          ) ?? undefined,
        }
      );
    }

    await completeManufacturingBatch(
      id,
      batch.id,
      {
        locationId: payload.locationId,
        actualQuantity: undefined,
        outputDisposition: payload.outputDisposition,
        ingredientActuals: [],
        confirmNegativeStock: payload.confirmNegativeStock,
        producedLotId: batchProducedLotId,
        producedLotNumber: batchProducedLotNumber,
      },
      {
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `batch-complete:${batch.id}`
        ) ?? undefined,
      }
    );
    completedBatchCount += 1;
  }

  throw new ManufacturingError("Too many batches to complete in one request.", 400);
}

async function completeDiscreteManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string; ingredientTrackedLotDefault?: "unbatched" }
): Promise<{ id: string; completedOrder: boolean; orgId: string | null }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "completeManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, payload },
    });

    if (replay.replayed) {
      return { ...replay.result, completedOrder: false, orgId: null };
    }

    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can be completed", 400);
    }

    const outputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: id,
    });
    if (outputQuantity > 0) {
      if (payload.actualQuantity != null) {
        throw new ManufacturingError(
          "Output is already recorded for this order.",
          400
        );
      }

      const demandRows = await getManufacturingIngredientDemandRowsInTx(tx, id);
      await releaseIngredientDemandForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
        reason: "completed",
        ingredientIds: demandRows.map((row) => row.ingredientId),
      });
      await releaseRemainingExpectedOutputInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
      });

      const [completed] = await tx
        .update(manufacturingOrders)
        .set({
          status: "done",
          priorityRank: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, id))
        .returning({ id: manufacturingOrders.id });

      await rerankOpenManufacturingOrdersInTx(tx, orgId);

      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: completed,
      });

      return { ...completed, completedOrder: true, orgId };
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
    const ingredientRows = await getTemplateIngredientsInTx(tx, id);

    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    const allocationTotals = await getPickAllocationTotalsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.id)
    );

    const actualsMap = buildIngredientActualsMap(
      payload.ingredientActuals,
      ingredientRows
    );
    const plannedOutputQuantity = Number(order.plannedQuantity);
    const actualToPlannedRatio =
      Number.isFinite(plannedOutputQuantity) && plannedOutputQuantity > 0
        ? actualQuantity / plannedOutputQuantity
        : 1;

    let totalMaterialCost = 0;
    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const pickedQty = parseFloat(ingredient.pickedQuantity);
      const plannedActualQty = normalizeQuantityNumber(
        parseFloat(ingredient.plannedQuantity) * actualToPlannedRatio
      );
      const suppliedActual =
        actualsMap.get(ingredient.id) ??
        (pickedQty < plannedActualQty ? plannedActualQty : null);
      let effectiveQuantity: number;
      let effectiveCost: number;

      if (suppliedActual != null) {
        const additionalUnpickedQuantity = Math.max(0, suppliedActual - pickedQty);
        const minimumLotAgeDays = getMinimumLotAgeDays(ingredient.constraints);
        const requiredDate =
          additionalUnpickedQuantity > 0 && minimumLotAgeDays != null
            ? await getOrganizationTodayInTx(tx, orgId)
            : null;
        const minimumReceivedDate =
          requiredDate != null && minimumLotAgeDays != null
            ? subtractDays(requiredDate, minimumLotAgeDays)
            : null;
        if (
          additionalUnpickedQuantity > 0 &&
          minimumLotAgeDays != null &&
          payload.confirmNegativeStock !== true &&
          requiredDate != null
        ) {
          const location = await resolveInventoryLocationInTx(tx, orgId, payload.locationId);
          const ageAvailability = await getLotAgeAvailabilityInTx(tx, {
            organizationId: orgId,
            locationId: location.id,
            itemId: ingredient.itemId,
            minimumLotAgeDays,
            requiredDate,
          });

          if (ageAvailability.eligible < additionalUnpickedQuantity) {
            const lotAgeConstraint = ingredient.constraints.find(
              (constraint) => constraint.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT
            );
            const requirementViolation = lotAgeConstraint
              ? evaluateLotAgeMinDaysRequirement({
                  constraint: lotAgeConstraint,
                  requiredQuantity: additionalUnpickedQuantity,
                  eligibleQuantity: ageAvailability.eligible,
                  nextEligibleDate: ageAvailability.nextEligibleDate,
                })
              : null;

            throw new ManufacturingError(
              `Not enough eligible ${ingredient.itemName}.`,
              409,
              {
                shortage: {
                  ingredients: [
                    {
                      itemId: ingredient.itemId,
                      itemName: ingredient.itemName,
                      unitName: ingredient.unitName,
                      needed: additionalUnpickedQuantity,
                      available: ageAvailability.eligible,
                      shortage: normalizeQuantityNumber(
                        additionalUnpickedQuantity - ageAvailability.eligible
                      ),
                      warningType: "requirement_violation",
                      requirement: formatMinimumLotAgeRequirementViolation(
                        minimumLotAgeDays
                      ),
                      requirementViolations: requirementViolation
                        ? [requirementViolation]
                        : [],
                      nextEligibleDate: ageAvailability.nextEligibleDate,
                    },
                  ],
                },
              }
            );
          }
        }

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
            referenceType: "manufacturing_order",
            referenceId: id,
            actorUserId: userId,
            idempotencyKey: deriveInventoryIdempotencyKey(
              options?.idempotencyKey,
              `variance:${ingredient.id}`
            ),
            minimumReceivedDate,
            allowIneligibleLots: payload.confirmNegativeStock === true,
            allowNegativeStock: payload.confirmNegativeStock === true,
            trackedLotDefault: options?.ingredientTrackedLotDefault,
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

      totalMaterialCost += effectiveCost;

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

    const absorbedOperationCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      id,
      actualQuantity,
      { absorbFullFixedCost: true }
    );
    const actualCostPerUnit = (totalMaterialCost + absorbedOperationCost) / actualQuantity;

    const targetLot = await resolveProducedLotForUnitInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      manufacturingOrderBatchId: null,
      productId: order.productId,
      selection: payload,
    });
    const produced = await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      productId: order.productId,
      quantity: actualQuantity,
      locationId: payload.locationId,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      lotId: targetLot.lotId,
      newLotNumber: targetLot.newLotNumber,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "complete-output"
      ),
      expectedReleaseQuantity: null,
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });
    await releaseIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      actorUserId: userId,
      reason: "completed",
      ingredientIds: produceIngredientRows.map((row) => row.ingredientId),
    });

    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      produceIngredientRows.map((ingredient) => ingredient.ingredientId)
    );
    const outputConsumptionRows = buildOutputConsumptionsFromPickedAllocations(
      produceIngredientRows,
      pickAllocationsByIngredient
    );

    await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: id,
      manufacturingOrderBatchId: null,
      lotId: produced.lotId,
      locationId: produced.locationId,
      quantity: actualQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal: totalMaterialCost,
      notes: null,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
    });

    const [completed] = await tx
      .update(manufacturingOrders)
      .set({
        status: "done",
        priorityRank: null,
        actualQuantity: normalizeNumeric(actualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualOperationsCost: normalizeNumericScale(absorbedOperationCost, 6),
        actualCostPerUnit: normalizeNumeric(actualCostPerUnit),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await rerankOpenManufacturingOrdersInTx(tx, orgId);

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: completed,
    });

    return { ...completed, completedOrder: true, orgId };
  });
}

export async function completeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string; ingredientTrackedLotDefault?: "unbatched" }
): Promise<{ id: string }> {
  const order = await getManufacturingOrderCompletionTarget(id);

  if (order.manufacturingMode === "batch") {
    const completed = await completeBatchModeManufacturingOrder(id, payload, options);
    return completed;
  }

  const completed = await completeDiscreteManufacturingOrder(id, payload, options);
  await notifyIfManufacturingOrderJustCompleted(completed);
  return { id: completed.id };
}
