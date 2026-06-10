import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { inventoryLotBalances, manufacturingOrderBatches, manufacturingOrderIngredients, organization } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeQuantityNumber, todayInTimeZone } from "@/lib/format";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { beginInventoryOperationInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, getDefaultInventoryLocationInTx, pickManufacturingIngredientInTx } from "@/lib/inventory/kernel";
import { evaluateLotAgeMinDaysRequirement, formatMinimumLotAgeRequirementViolation, getMinimumLotAgeDays, LOT_AGE_MIN_DAYS_CONSTRAINT } from "@/lib/bom/constraints";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { demandQueueCoverageKey, getDemandQueueCoverageByDemandKeyForItemsInTx } from "@/lib/inventory/allocation/demand-queue";
import { ManufacturingError } from "./errors";
import { getManufacturingExecutionDetail } from "./execution-read";
import { type LockedBatchStateRow, assertCurrentExecutionBatch, ensureBatchExecutionRowsInTx, getBatchIngredientsInTx, getIngredientConstraintsByIdInTx, getLockedBatchStateRowsInTx } from "./execution-state";
import { getLockedManufacturingOrderInTx, getRemainingQuantityNumber, isOpenManufacturingOrder, validateActiveIngredientItemsInTx } from "./shared";

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

async function getOrganizationTodayInTx(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? "America/Denver");
}

function subtractDays(value: string, days: number) {
  return addDays(value, -days);
}

function lotAgeRequirementText(days: number) {
  return formatMinimumLotAgeRequirementViolation(days);
}

async function getLotAgeAvailabilityInTx(
  tx: Tx,
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
  let ineligible = 0;
  let nextEligibleDate: string | null = null;

  for (const row of rows) {
    const quantity = parseFloat(row.quantity);
    const receivedDate = isoDate(row.receivedAt);
    const eligibleDate = addDays(receivedDate, params.minimumLotAgeDays);
    if (receivedDate <= cutoffReceivedDate) {
      eligible += quantity;
      continue;
    }

    ineligible += quantity;
    if (nextEligibleDate == null || eligibleDate < nextEligibleDate) {
      nextEligibleDate = eligibleDate;
    }
  }

  return {
    eligible: normalizeQuantityNumber(Math.max(0, eligible)),
    ineligible: normalizeQuantityNumber(ineligible),
    nextEligibleDate,
  };
}

async function getManufacturingIngredientQueueAvailableQtyInTx(
  tx: Tx,
  params: {
    organizationId: string;
    ingredientId: string;
    itemId: string;
  }
) {
  const coverageByDemandKey = await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
    organizationId: params.organizationId,
    itemIds: [params.itemId],
    includeManufacturingDetail: true,
  });
  const coverage = coverageByDemandKey.get(
    demandQueueCoverageKey({
      demandType: "manufacturing_order_ingredient",
      demandId: params.ingredientId,
    })
  );

  return normalizeQuantityNumber(Number.parseFloat(coverage?.inStockQty ?? "0") || 0);
}

export async function pickManufacturingIngredient(
  orderId: string,
  ingredientId: string,
  options?: {
    idempotencyKey?: string;
    confirmRequirementOverride?: boolean;
    confirmNegativeStock?: boolean;
  }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const confirmRequirementOverride = options?.confirmRequirementOverride === true;
    const confirmNegativeStock =
      options?.confirmNegativeStock === true || confirmRequirementOverride;
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "pickManufacturingIngredient",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        orderId,
        ingredientId,
        confirmRequirementOverride,
        confirmNegativeStock,
      },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can be picked", 400);
    }

    let lockedBatches: LockedBatchStateRow[] = [];
    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      lockedBatches = await getLockedBatchStateRowsInTx(tx, orderId);
    }

    const [ingredient] = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
        unitName: manufacturingOrderIngredients.unitName,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.id, ingredientId),
          eq(manufacturingOrderIngredients.manufacturingOrderId, orderId)
        )
      )
      .for("update");

    if (!ingredient) {
      throw new ManufacturingError("Ingredient not found", 404);
    }

    const remainingQuantity = getRemainingQuantityNumber(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    );

    if (remainingQuantity <= 0) {
      throw new ManufacturingError(`"${ingredient.itemName}" is already picked.`, 400);
    }

    await validateActiveIngredientItemsInTx(tx, [ingredient.itemId]);

    const constraintsByIngredientId = await getIngredientConstraintsByIdInTx(tx, [
      ingredient.id,
    ]);
    const ingredientConstraints = constraintsByIngredientId.get(ingredient.id) ?? [];
    const lotAgeConstraint = ingredientConstraints.find(
      (constraint) => constraint.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT
    );
    const minimumLotAgeDays = getMinimumLotAgeDays(ingredientConstraints);
    const pickDate = await getOrganizationTodayInTx(tx, orgId);
    const minimumReceivedDate =
      minimumLotAgeDays == null ? null : subtractDays(pickDate, minimumLotAgeDays);

    if (minimumLotAgeDays != null) {
      const location = await getDefaultInventoryLocationInTx(tx, orgId);
      const ageAvailability = await getLotAgeAvailabilityInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId: ingredient.itemId,
        minimumLotAgeDays,
        requiredDate: pickDate,
      });

      if (
        ageAvailability.eligible < remainingQuantity &&
        !confirmRequirementOverride
      ) {
        const requirementViolation = lotAgeConstraint
          ? evaluateLotAgeMinDaysRequirement({
              requirementId: lotAgeConstraint.id,
              requirement: {
                id: lotAgeConstraint.id,
                requirementType: lotAgeConstraint.constraintType,
                config: lotAgeConstraint.config,
                sortOrder: lotAgeConstraint.sortOrder,
              },
              requiredQuantity: remainingQuantity,
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
                  needed: remainingQuantity,
                  available: ageAvailability.eligible,
                  shortage: normalizeQuantityNumber(
                    remainingQuantity - ageAvailability.eligible
                  ),
                  warningType: "requirement_violation",
                  requirement: lotAgeRequirementText(minimumLotAgeDays),
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

    if (ingredient.manufacturingOrderBatchId != null) {
      const batch = assertCurrentExecutionBatch(
        lockedBatches,
        ingredient.manufacturingOrderBatchId,
        "picked"
      );

      if (batch.status === "pending") {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            status: "in_progress",
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, batch.id));
      }
    }

    const queueAvailable = await getManufacturingIngredientQueueAvailableQtyInTx(tx, {
      organizationId: orgId,
      ingredientId,
      itemId: ingredient.itemId,
    });

    if (queueAvailable < remainingQuantity && !confirmNegativeStock) {
      throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
        shortage: {
          ingredients: [
            {
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              unitName: ingredient.unitName,
              needed: remainingQuantity,
              available: queueAvailable,
              shortage: normalizeQuantityNumber(remainingQuantity - queueAvailable),
              warningType: "queue_conflict",
            },
          ],
        },
      });
    }

    try {
      await pickManufacturingIngredientInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: orderId,
        ingredientId,
        itemId: ingredient.itemId,
        quantity: remainingQuantity,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `pick-ingredient:${ingredientId}`
        ),
        minimumReceivedDate,
        confirmRequirementOverride,
        allowNegativeStock: confirmNegativeStock,
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

    await tx
      .update(manufacturingOrderIngredients)
      .set({
        pickedQuantity: ingredient.plannedQuantity,
        pickStatus: "picked",
        pickedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderIngredients.id, ingredient.id));

    if (ingredient.manufacturingOrderBatchId != null) {
      const batchIngredients = await getBatchIngredientsInTx(
        tx,
        ingredient.manufacturingOrderBatchId
      );
      const fullyPicked = batchIngredients.every(
        (row) => getRemainingQuantityNumber(row.plannedQuantity, row.pickedQuantity) <= 0
      );

      if (fullyPicked) {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            pickedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, ingredient.manufacturingOrderBatchId));
      }
    }

    const result = { id: ingredient.id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function pickRemainingManufacturingIngredients(
  orderId: string,
  options?: {
    idempotencyKey?: string;
    confirmRequirementOverride?: boolean;
    confirmNegativeStock?: boolean;
  }
): Promise<{ ids: string[] }> {
  const execution = await getManufacturingExecutionDetail(orderId);

  if (!execution) {
    throw new ManufacturingError("Order not found", 404);
  }

  if (execution.status !== "open") {
    throw new ManufacturingError("Only open orders can be picked", 400);
  }

  if (
    execution.manufacturingMode === "batch" &&
    execution.currentBatch?.status === "pending"
  ) {
    throw new ManufacturingError(
      `Start batch ${execution.currentBatch.batchNumber} before marking ingredients done.`,
      400
    );
  }

  const remainingIngredients = execution.ingredients.filter(
    (ingredient) =>
      getRemainingQuantityNumber(
        ingredient.plannedQuantity,
        ingredient.pickedQuantity
      ) > 0
  );
  const pickedIds: string[] = [];

  for (const ingredient of remainingIngredients) {
    await pickManufacturingIngredient(orderId, ingredient.id, {
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        `pick-remaining:${ingredient.id}`
      ) ?? undefined,
      confirmRequirementOverride: options?.confirmRequirementOverride,
      confirmNegativeStock: options?.confirmNegativeStock,
    });
    pickedIds.push(ingredient.id);
  }

  return { ids: pickedIds };
}
