import { and, desc, eq, inArray } from "drizzle-orm";
import {
  type InventoryDisposition,
  inventoryDemandSummary,
  inventoryExpectedSummary,
  manufacturingOrderIngredients,
  manufacturingPickAllocations,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { normalizeNumericScale } from "@/lib/format";
import { assertTrackedItemInTx } from "@/lib/inventory/lot-tracking";
import {
  getDefaultInventoryLocationInTx,
  resolveInventoryLocationInTx,
} from "@/lib/inventory/kernel/locations";
import {
  applyDemandReferenceDeltasInTx,
  applyExpectedReferenceDeltasInTx,
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import {
  appendPositiveStockToExistingLotInTx,
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  getPhysicalAvailableOnHandQtyAtLocationInTx,
  restockExistingLotInTx,
} from "@/lib/inventory/kernel/operations/stock-core";

export async function addExpectedFromManufacturingInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    productId: string;
    quantity: number;
    // Output location; omitted = default.
    locationId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "addExpectedFromManufacturing",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      productId: params.productId,
      quantity: params.quantity,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const events = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "manufacturing_release",
    deltas: [
      {
        itemId: params.productId,
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        quantity: params.quantity,
      },
    ],
  });

  const result = { referenceIds: [params.manufacturingOrderId] };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
    result,
  });

  return result;
}

export async function editExpectedFromManufacturingInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    productId: string;
    nextQuantity: number;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "editExpectedFromManufacturing",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      productId: params.productId,
      nextQuantity: params.nextQuantity,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const [existing] = await tx
    .select({ quantity: inventoryExpectedSummary.quantity })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, params.organizationId),
        eq(inventoryExpectedSummary.locationId, location.id),
        eq(inventoryExpectedSummary.referenceType, "manufacturing_order"),
        eq(inventoryExpectedSummary.referenceId, params.manufacturingOrderId)
      )
    );

  const events = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "manufacturing_edit",
    deltas: [
      {
        itemId: params.productId,
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        quantity: params.nextQuantity - parseFloat(existing?.quantity ?? "0"),
      },
    ],
  });

  const result = { referenceIds: [params.manufacturingOrderId] };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: events[0]?.id ?? null,
    result,
  });

  return result;
}

export async function addIngredientDemandForManufacturingInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    ingredients: Array<{
      ingredientId: string;
      itemId: string;
      quantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "addIngredientDemandForManufacturing",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      ingredients: params.ingredients,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const deltas = params.ingredients.map((ingredient) => ({
    itemId: ingredient.itemId,
    referenceType: "manufacturing_order_ingredient",
    referenceId: ingredient.ingredientId,
    quantity: ingredient.quantity,
  }));
  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: "manufacturing_release",
    deltas,
  });

  const result = {
    referenceIds: params.ingredients.map((ingredient) => ingredient.ingredientId),
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function releaseIngredientDemandForManufacturingInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    reason: "cancelled" | "picked" | "completed" | "edited";
    ingredientIds: string[];
  }
) {
  const replay = await beginInventoryOperationInTx<{ referenceIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "releaseIngredientDemandForManufacturing",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      reason: params.reason,
      ingredientIds: params.ingredientIds,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const existingDemandRows = await tx
    .select({
      itemId: inventoryDemandSummary.itemId,
      referenceId: inventoryDemandSummary.referenceId,
      quantity: inventoryDemandSummary.quantity,
    })
    .from(inventoryDemandSummary)
    .where(
      and(
        eq(inventoryDemandSummary.organizationId, params.organizationId),
        eq(inventoryDemandSummary.locationId, location.id),
        eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
        inArray(inventoryDemandSummary.referenceId, params.ingredientIds)
      )
    );

  const demandEvents = await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    eventSubtype: params.reason,
    deltas: existingDemandRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "manufacturing_order_ingredient",
      referenceId: row.referenceId,
      quantity: -parseFloat(row.quantity),
    })),
  });

  const result = {
    referenceIds: [...new Set(existingDemandRows.map((row) => row.referenceId))],
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: demandEvents[0]?.id ?? null,
    result,
  });

  return result;
}

export async function pickManufacturingIngredientInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    ingredientId: string;
    itemId: string;
    quantity: number;
    // Pick location; omitted = default. Recorded on each allocation so
    // unpick and variance restores return stock to where it came from.
    locationId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    minimumReceivedDate?: string | null;
    confirmRequirementOverride?: boolean;
    allowNegativeStock?: boolean;
  }
) {
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "pickManufacturingIngredient",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      ingredientId: params.ingredientId,
      itemId: params.itemId,
      quantity: params.quantity,
      locationId: params.locationId ?? null,
      minimumReceivedDate: params.minimumReceivedDate ?? null,
      confirmRequirementOverride: params.confirmRequirementOverride ?? false,
      allowNegativeStock: params.allowNegativeStock ?? false,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.locationId
  );
  await lockItemsInTx(tx, [params.itemId]);
  const available = await getPhysicalAvailableOnHandQtyAtLocationInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
  });

  if (available < params.quantity && !params.allowNegativeStock) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available,
      requested: params.quantity,
    });
  }

  const consumed = await consumeStockFifoInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.itemId,
    quantity: params.quantity,
    eventType: "manufacturing_ingredient_consumption",
    eventSubtype: "manufacturing_pick",
    referenceType: "manufacturing_order",
    referenceId: params.manufacturingOrderId,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    minimumReceivedDate: params.minimumReceivedDate ?? null,
    allowIneligibleLots: params.confirmRequirementOverride ?? false,
    allowNegativeStock: params.allowNegativeStock ?? false,
    metadata: { manufacturingOrderIngredientId: params.ingredientId },
  });

  if (consumed.allocations.length > 0) {
    await tx.insert(manufacturingPickAllocations).values(
      consumed.allocations.map((allocation) => {
        const requirementViolated =
          "requirementViolated" in allocation && allocation.requirementViolated;

        return {
          manufacturingOrderIngredientId: params.ingredientId,
          lotId: allocation.lotId,
          locationId: location.id,
          quantityUsed: normalizeNumericScale(allocation.quantity, 4),
          costPerUnit: normalizeNumericScale(allocation.unitCost, 6),
          requirementOverrideConfirmed: Boolean(requirementViolated),
          requirementOverrideConfirmedBy: requirementViolated
            ? params.actorUserId ?? "system"
            : null,
          requirementOverrideConfirmedAt: requirementViolated ? new Date() : null,
          createdBy: params.actorUserId ?? "system",
        };
      })
    );
  }

  // Planning is default-pinned in v1: expected/demand balances were recorded
  // at the default location and must be released there, regardless of where
  // the physical leg happened.
  const planningLocation = await getDefaultInventoryLocationInTx(
    tx,
    params.organizationId
  );
  await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: planningLocation.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "picked",
    deltas: [
      {
        itemId: params.itemId,
        referenceType: "manufacturing_order_ingredient",
        referenceId: params.ingredientId,
        quantity: -params.quantity,
      },
    ],
  });

  const result = { eventIds: consumed.eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: consumed.eventIds[0] ?? null,
    result,
  });

  return result;
}

export async function unpickManufacturingIngredientInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    ingredientId: string;
    itemId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "unpickManufacturingIngredient",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      ingredientId: params.ingredientId,
      itemId: params.itemId,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const allocations = await tx
    .select({
      id: manufacturingPickAllocations.id,
      lotId: manufacturingPickAllocations.lotId,
      locationId: manufacturingPickAllocations.locationId,
      quantityUsed: manufacturingPickAllocations.quantityUsed,
      costPerUnit: manufacturingPickAllocations.costPerUnit,
    })
    .from(manufacturingPickAllocations)
    .where(
      eq(manufacturingPickAllocations.manufacturingOrderIngredientId, params.ingredientId)
    );

  const eventIds: string[] = [];
  for (const [index, allocation] of allocations.entries()) {
    const restocked = await restockExistingLotInTx(tx, {
      organizationId: params.organizationId,
      locationId: allocation.locationId ?? location.id,
      itemId: params.itemId,
      lotId: allocation.lotId,
      quantity: parseFloat(allocation.quantityUsed),
      unitCost: allocation.costPerUnit ?? "0",
      referenceType: "manufacturing_order",
      referenceId: params.manufacturingOrderId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: index === 0 ? params.idempotencyKey ?? null : null,
      metadata: { manufacturingOrderIngredientId: params.ingredientId },
    });
    eventIds.push(restocked.eventId);
  }

  await tx
    .delete(manufacturingPickAllocations)
    .where(
      eq(manufacturingPickAllocations.manufacturingOrderIngredientId, params.ingredientId)
    );

  const totalQuantity = allocations.reduce(
    (sum, allocation) => sum + parseFloat(allocation.quantityUsed),
    0
  );

  await applyDemandReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "unpicked",
    deltas: totalQuantity
      ? [
          {
            itemId: params.itemId,
            referenceType: "manufacturing_order_ingredient",
            referenceId: params.ingredientId,
            quantity: totalQuantity,
          },
        ]
      : [],
  });

  const result = { eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}

export async function produceManufacturedStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    productId: string;
    quantity: number;
    // Output location; omitted = default.
    locationId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lotId?: string | null;
    newLotNumber?: string | null;
    outputDisposition?: Extract<InventoryDisposition, "available" | "blocked">;
    overheadCostTotal?: number;
    expectedReleaseQuantity?: number | null;
    ingredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{
    eventIds: string[];
    lotId: string;
    locationId: string;
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "produceManufacturedStock",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      productId: params.productId,
      quantity: params.quantity,
      locationId: params.locationId ?? null,
      overheadCostTotal: params.overheadCostTotal ?? 0,
      outputDisposition: params.outputDisposition ?? "available",
      lotId: params.lotId ?? null,
      newLotNumber: params.newLotNumber ?? null,
      expectedReleaseQuantity: params.expectedReleaseQuantity ?? null,
      ingredientRows: params.ingredientRows,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  if ((params.outputDisposition ?? "available") !== "available") {
    await assertTrackedItemInTx(
      tx,
      params.productId,
      "Untracked items can only be produced as available."
    );
  }

  const ingredientCostTotal = params.ingredientRows.reduce(
    (sum, ingredient) => sum + ingredient.actualCostTotal,
    0
  );
  const totalCost = ingredientCostTotal + (params.overheadCostTotal ?? 0);
  const unitCost = normalizeNumericScale(totalCost / params.quantity, 6);
  const location = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.locationId
  );

  const stockEventParams = {
    organizationId: params.organizationId,
    locationId: location.id,
    itemId: params.productId,
    quantity: params.quantity,
    unitCost,
    disposition: params.outputDisposition ?? "available",
    eventType: "manufacturing_output" as const,
    eventSubtype: "manufacturing_complete",
    referenceType: "manufacturing_order",
    referenceId: params.manufacturingOrderId,
    actorUserId: params.actorUserId ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    metadata: {
      ingredientCostTotal: normalizeNumericScale(ingredientCostTotal, 6),
      overheadCostTotal: normalizeNumericScale(params.overheadCostTotal ?? 0, 6),
      ingredientIds: params.ingredientRows.map((row) => row.ingredientId),
    },
  };
  const created = params.lotId
    ? await appendPositiveStockToExistingLotInTx(tx, {
        ...stockEventParams,
        lotId: params.lotId,
      })
    : await createPositiveStockEventInTx(tx, {
        ...stockEventParams,
        lotNumber: params.newLotNumber ?? null,
      });

  // Planning is default-pinned in v1: expected output was recorded at the
  // default location and must be released there, regardless of where the
  // physical output landed.
  const planningLocation = await getDefaultInventoryLocationInTx(
    tx,
    params.organizationId
  );
  const existingExpected = await tx
    .select({
      itemId: inventoryExpectedSummary.itemId,
      quantity: inventoryExpectedSummary.quantity,
    })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, params.organizationId),
        eq(inventoryExpectedSummary.locationId, planningLocation.id),
        eq(inventoryExpectedSummary.referenceType, "manufacturing_order"),
        eq(inventoryExpectedSummary.referenceId, params.manufacturingOrderId)
      )
    );

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: planningLocation.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "manufacturing_complete",
    deltas: existingExpected
      .map((row) => {
        const currentOpenQty = parseFloat(row.quantity);
        const releaseQuantity =
          params.expectedReleaseQuantity == null
            ? currentOpenQty
            : Math.min(currentOpenQty, params.expectedReleaseQuantity);

        if (releaseQuantity <= 0) {
          return null;
        }

        return {
          itemId: row.itemId,
          referenceType: "manufacturing_order",
          referenceId: params.manufacturingOrderId,
          quantity: -releaseQuantity,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null),
  });

  const result = {
    eventIds: [created.eventId],
    lotId: created.lotId,
    locationId: location.id,
  };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: created.eventId,
    result,
  });

  return result;
}

export async function cancelReleasedManufacturingOrderInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    productId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    ingredientRows: Array<{
      ingredientId: string;
      itemId: string;
      pickedQuantity: number;
    }>;
  }
) {
  const replay = await beginInventoryOperationInTx<{ eventIds: string[] }>(tx, {
    organizationId: params.organizationId,
    operationName: "cancelManufacturingOrder",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      manufacturingOrderId: params.manufacturingOrderId,
      productId: params.productId,
      ingredientRows: params.ingredientRows,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const eventIds: string[] = [];
  for (const ingredient of params.ingredientRows.filter((row) => row.pickedQuantity > 0)) {
    const result = await unpickManufacturingIngredientInTx(tx, {
      organizationId: params.organizationId,
      manufacturingOrderId: params.manufacturingOrderId,
      ingredientId: ingredient.ingredientId,
      itemId: ingredient.itemId,
      actorUserId: params.actorUserId ?? null,
    });
    eventIds.push(...result.eventIds);
  }

  await releaseIngredientDemandForManufacturingInTx(tx, {
    organizationId: params.organizationId,
    manufacturingOrderId: params.manufacturingOrderId,
    actorUserId: params.actorUserId ?? null,
    reason: "cancelled",
    ingredientIds: params.ingredientRows.map((row) => row.ingredientId),
  });

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

  const releasedExpected = await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "cancelled",
    deltas: expectedRows.map((row) => ({
      itemId: row.itemId,
      referenceType: "manufacturing_order",
      referenceId: params.manufacturingOrderId,
      quantity: -parseFloat(row.quantity),
    })),
  });
  eventIds.push(...releasedExpected.map((row) => row.id));

  const result = { eventIds };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId: eventIds[0] ?? null,
    result,
  });

  return result;
}

export async function getManufacturingIngredientDemandRowsInTx(
  tx: Tx,
  manufacturingOrderId: string
) {
  return tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      pickedQuantity: manufacturingOrderIngredients.pickedQuantity,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId));
}

const VARIANCE_EPSILON = 0.0001;

export async function reconcileIngredientActualsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    ingredient: {
      id: string;
      itemId: string;
      pickedQuantity: number;
    };
    actualConsumedQuantity: number;
    referenceType: string;
    referenceId: string;
    // Variance location: extra consumption happens here; restores return to
    // each allocation's recorded location. Omitted = default.
    locationId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    allowNegativeStock?: boolean;
    trackedLotDefault?: "unbatched";
  }
): Promise<{ newTotalQuantity: number; newTotalCost: number }> {
  const replay = await beginInventoryOperationInTx<{
    newTotalQuantity: number;
    newTotalCost: number;
  }>(tx, {
    organizationId: params.organizationId,
    operationName: "reconcileIngredientActuals",
    idempotencyKey: params.idempotencyKey ?? null,
    payload: {
      ingredientId: params.ingredient.id,
      itemId: params.ingredient.itemId,
      pickedQuantity: params.ingredient.pickedQuantity,
      actualConsumedQuantity: params.actualConsumedQuantity,
      locationId: params.locationId ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      trackedLotDefault: params.trackedLotDefault ?? null,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  const delta = params.actualConsumedQuantity - params.ingredient.pickedQuantity;
  const location = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.locationId
  );
  let firstEventId: string | null = null;

  if (delta > VARIANCE_EPSILON) {
    const consumed = await consumeStockFifoInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.ingredient.itemId,
      quantity: delta,
      eventType: "manufacturing_variance_loss",
      eventSubtype: "manufacturing_actuals",
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      metadata: { manufacturingOrderIngredientId: params.ingredient.id },
      allowNegativeStock: params.allowNegativeStock ?? false,
      trackedLotDefault: params.trackedLotDefault,
    });
    firstEventId = consumed.eventIds[0] ?? null;

    if (consumed.allocations.length > 0) {
      await tx.insert(manufacturingPickAllocations).values(
        consumed.allocations.map((allocation) => ({
          manufacturingOrderIngredientId: params.ingredient.id,
          lotId: allocation.lotId,
          locationId: location.id,
          quantityUsed: normalizeNumericScale(allocation.quantity, 4),
          costPerUnit: normalizeNumericScale(allocation.unitCost, 4),
          createdBy: params.actorUserId ?? "system",
        }))
      );
    }
  } else if (delta < -VARIANCE_EPSILON) {
    let remaining = -delta;
    const allocations = await tx
      .select({
        id: manufacturingPickAllocations.id,
        lotId: manufacturingPickAllocations.lotId,
        locationId: manufacturingPickAllocations.locationId,
        quantityUsed: manufacturingPickAllocations.quantityUsed,
        costPerUnit: manufacturingPickAllocations.costPerUnit,
      })
      .from(manufacturingPickAllocations)
      .where(
        eq(
          manufacturingPickAllocations.manufacturingOrderIngredientId,
          params.ingredient.id
        )
      )
      .orderBy(
        desc(manufacturingPickAllocations.createdAt),
        desc(manufacturingPickAllocations.id)
      )
      .for("update");

    let restockIndex = 0;
    for (const allocation of allocations) {
      if (remaining <= VARIANCE_EPSILON) break;
      const allocQty = parseFloat(allocation.quantityUsed);
      const returnQty = Math.min(allocQty, remaining);

      const restocked = await restockExistingLotInTx(tx, {
        organizationId: params.organizationId,
        locationId: allocation.locationId ?? location.id,
        itemId: params.ingredient.itemId,
        lotId: allocation.lotId,
        quantity: returnQty,
        unitCost: allocation.costPerUnit ?? "0",
        eventType: "manufacturing_variance_gain",
        eventSubtype: "manufacturing_actuals",
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey:
          restockIndex === 0 ? params.idempotencyKey ?? null : null,
        metadata: { manufacturingOrderIngredientId: params.ingredient.id },
      });
      if (firstEventId == null) {
        firstEventId = restocked.eventId;
      }

      const remainingOnAllocation = allocQty - returnQty;
      if (remainingOnAllocation <= VARIANCE_EPSILON) {
        await tx
          .delete(manufacturingPickAllocations)
          .where(eq(manufacturingPickAllocations.id, allocation.id));
      } else {
        await tx
          .update(manufacturingPickAllocations)
          .set({ quantityUsed: normalizeNumericScale(remainingOnAllocation, 4) })
          .where(eq(manufacturingPickAllocations.id, allocation.id));
      }

      remaining -= returnQty;
      restockIndex++;
    }
  }

  const updatedAllocations = await tx
    .select({
      quantityUsed: manufacturingPickAllocations.quantityUsed,
      costPerUnit: manufacturingPickAllocations.costPerUnit,
    })
    .from(manufacturingPickAllocations)
    .where(
      eq(
        manufacturingPickAllocations.manufacturingOrderIngredientId,
        params.ingredient.id
      )
    );

  let newTotalQuantity = 0;
  let newTotalCost = 0;
  for (const row of updatedAllocations) {
    const q = parseFloat(row.quantityUsed);
    const c = row.costPerUnit != null ? parseFloat(row.costPerUnit) : 0;
    newTotalQuantity += q;
    newTotalCost += q * c;
  }

  const result = { newTotalQuantity, newTotalCost };

  await finishInventoryOperationInTx(tx, {
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey ?? null,
    firstEventId,
    result,
  });

  return result;
}
