import "server-only";

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { type InventoryDisposition, manufacturingOrderBatches, manufacturingOrderOperationCosts, manufacturingOrderOutputConsumptions, manufacturingOrderOutputs, manufacturingOrderIngredients, manufacturingOrders, manufacturingPickAllocations } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeNumericScale, normalizeQuantityNumber } from "@/lib/format";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import type { Tx } from "@/lib/db/with-org-context";
import { applyDemandReferenceDeltasInTx, applyExpectedReferenceDeltasInTx, beginInventoryOperationInTx, consumeStockFifoInTx, decrementExistingLotStockInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, getDefaultInventoryLocationInTx, produceManufacturedStockInTx, resolveInventoryLocationInTx, restockExistingLotInTx } from "@/lib/inventory/kernel";
import { calculatePlannedOperationCost } from "@/lib/manufacturing/operation-costs";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type { RecordManufacturingOutput } from "@/lib/schemas/manufacturing-orders";
import { ManufacturingError } from "./errors";
import { type LockedBatchStateRow, assertCurrentExecutionBatch, ensureBatchExecutionRowsInTx, getBatchIngredientsInTx, getCurrentExecutionBatch, getLockedBatchStateRowsInTx, getOutputQuantityInTx, getPickAllocationsByIngredientInTx, getProducedLotIdInTx, getTemplateIngredientsInTx, resolveProducedLotForUnitInTx } from "./execution-state";
import { type LockedManufacturingOrder, getLockedManufacturingOrderInTx, isOpenManufacturingOrder, validateActiveIngredientItemsInTx } from "./shared";

export async function getAbsorbedOperationCostForQuantityInTx(
  tx: Tx,
  manufacturingOrderId: string,
  outputQuantity: number,
  options?: { absorbFullFixedCost?: boolean }
) {
  const [order] = await tx
    .select({
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
    })
    .from(manufacturingOrders)
    .where(eq(manufacturingOrders.id, manufacturingOrderId));
  const plannedQuantity = Number.parseFloat(order?.plannedQuantity ?? "0");
  const rows = await tx
    .select({
      costScalingMode: manufacturingOrderOperationCosts.costScalingMode,
      crewSize: trimScale(manufacturingOrderOperationCosts.crewSize).as("crewSize"),
      plannedMinutes: trimScale(manufacturingOrderOperationCosts.plannedMinutes).as(
        "plannedMinutes"
      ),
      loadedCostPerHour: trimScale(
        manufacturingOrderOperationCosts.loadedCostPerHour
      ).as("loadedCostPerHour"),
      plannedCostTotal: trimScale(
        manufacturingOrderOperationCosts.plannedCostTotal
      ).as("plannedCostTotal"),
    })
    .from(manufacturingOrderOperationCosts)
    .where(eq(manufacturingOrderOperationCosts.manufacturingOrderId, manufacturingOrderId));

  return rows.reduce((sum, row) => {
    if (row.costScalingMode === "per_output_unit") {
      return (
        sum +
        Number.parseFloat(
          calculatePlannedOperationCost({
            costScalingMode: "per_output_unit",
            crewSize: row.crewSize,
            plannedMinutes: row.plannedMinutes,
            loadedCostPerHour: row.loadedCostPerHour,
            outputQuantity,
          })
        )
      );
    }

    const plannedCost = Number.parseFloat(row.plannedCostTotal);
    if (options?.absorbFullFixedCost) {
      return sum + plannedCost;
    }

    if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
      return sum + plannedCost;
    }

    return sum + plannedCost * Math.min(outputQuantity / plannedQuantity, 1);
  }, 0);
}

export async function getIncrementalAbsorbedOperationCostForQuantityInTx(
  tx: Tx,
  manufacturingOrderId: string,
  previousOutputQuantity: number,
  outputQuantity: number,
  options?: { absorbFullFixedCost?: boolean }
) {
  const normalizedPreviousOutputQuantity = Math.max(previousOutputQuantity, 0);
  const normalizedOutputQuantity = Math.max(outputQuantity, 0);
  const previousCost =
    normalizedPreviousOutputQuantity > 0
      ? await getAbsorbedOperationCostForQuantityInTx(
          tx,
          manufacturingOrderId,
          normalizedPreviousOutputQuantity
        )
      : 0;
  const nextCost = await getAbsorbedOperationCostForQuantityInTx(
    tx,
    manufacturingOrderId,
    normalizedPreviousOutputQuantity + normalizedOutputQuantity,
    options
  );

  return Math.max(nextCost - previousCost, 0);
}

export async function getTotalOutputQuantityForOrderInTx(
  tx: Tx,
  manufacturingOrderId: string
) {
  const [row] = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId));

  return parseFloat(row?.quantity ?? "0");
}

export async function assertLinkedMtoOutputWithinSalesDemandInTx(
  tx: Tx,
  order: LockedManufacturingOrder,
  outputQuantity: number
) {
  if (!order.salesOrderId || !order.salesOrderLineId) return;

  const requiredQuantity = Number(order.requestedQuantity);
  if (!Number.isFinite(requiredQuantity)) return;

  const existingOutputQuantity = await getTotalOutputQuantityForOrderInTx(
    tx,
    order.id
  );
  if (existingOutputQuantity + outputQuantity <= requiredQuantity) return;

  throw new ManufacturingError(
    "Linked make-to-order output cannot exceed the sales order quantity.",
    400
  );
}

async function getConsumedQuantityByIngredientInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await tx
    .select({
      ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputConsumptions.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderOutputConsumptions)
    .where(
      inArray(manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId, uniqueIds)
    )
    .groupBy(manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId);

  return new Map(rows.map((row) => [row.ingredientId, parseFloat(row.quantity)]));
}

async function nextOutputNumberInTx(tx: Tx, manufacturingOrderId: string) {
  const [row] = await tx
    .select({
      value: sql<number>`COALESCE(MAX(${manufacturingOrderOutputs.outputNumber}), 0)::int`,
    })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId));

  return Number(row?.value ?? 0) + 1;
}

type ManufacturingOutputConsumptionInput = {
  manufacturingOrderIngredientId: string;
  lotId: string;
  // Where the consumption drew stock; reversal restores exactly here.
  locationId: string | null;
  quantityUsed: string;
  costPerUnit: string;
};

export async function insertManufacturingOrderOutputInTx(
  tx: Tx,
  params: {
    manufacturingOrderId: string;
    manufacturingOrderBatchId: string | null;
    lotId: string;
    // Resolved location the finished goods landed at; reversal decrements here.
    locationId: string;
    quantity: number;
    disposition: Extract<InventoryDisposition, "available" | "blocked">;
    materialCostTotal: number;
    notes?: string | null;
    actorUserId: string | null;
    consumptions: ManufacturingOutputConsumptionInput[];
  }
) {
  const [output] = await tx
    .insert(manufacturingOrderOutputs)
    .values({
      manufacturingOrderId: params.manufacturingOrderId,
      manufacturingOrderBatchId: params.manufacturingOrderBatchId,
      lotId: params.lotId,
      locationId: params.locationId,
      outputNumber: await nextOutputNumberInTx(tx, params.manufacturingOrderId),
      quantity: normalizeNumeric(params.quantity),
      disposition: params.disposition,
      unitCost:
        params.quantity > 0
          ? normalizeNumericScale(params.materialCostTotal / params.quantity, 6)
          : normalizeNumericScale(0, 6),
      materialCostTotal: normalizeNumericScale(params.materialCostTotal, 6),
      notes: params.notes ?? null,
      createdBy: params.actorUserId ?? "system",
    })
    .returning({ id: manufacturingOrderOutputs.id });

  if (params.consumptions.length > 0) {
    await tx.insert(manufacturingOrderOutputConsumptions).values(
      params.consumptions.map((row) => ({
        manufacturingOrderOutputId: output.id,
        ...row,
      }))
    );
  }

  return output;
}

export function buildOutputConsumptionsFromPickedAllocations(
  ingredients: Array<{ ingredientId: string; actualQuantity: number }>,
  allocationsByIngredient: Map<
    string,
    Array<{
      lotId: string;
      locationId: string | null;
      quantityUsed: string;
      costPerUnit: string | null;
    }>
  >
) {
  const rows: ManufacturingOutputConsumptionInput[] = [];

  for (const ingredient of ingredients) {
    let remainingQuantity = normalizeQuantityNumber(ingredient.actualQuantity);
    if (remainingQuantity <= 0) {
      continue;
    }

    const allocations = allocationsByIngredient.get(ingredient.ingredientId) ?? [];
    for (const allocation of allocations) {
      if (remainingQuantity <= 0) {
        break;
      }

      const allocationQuantity = parseFloat(allocation.quantityUsed);
      const quantityUsed = normalizeQuantityNumber(
        Math.min(remainingQuantity, allocationQuantity)
      );
      if (quantityUsed <= 0) {
        continue;
      }

      const costPerUnit = allocation.costPerUnit != null ? parseFloat(allocation.costPerUnit) : 0;
      rows.push({
        manufacturingOrderIngredientId: ingredient.ingredientId,
        lotId: allocation.lotId,
        locationId: allocation.locationId,
        quantityUsed: normalizeNumericScale(quantityUsed, 4),
        costPerUnit: normalizeNumericScale(costPerUnit, 6),
      });
      remainingQuantity = normalizeQuantityNumber(remainingQuantity - quantityUsed);
    }
  }

  return rows;
}

export async function reverseManufacturingOutputInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    manufacturingOrderBatchId: string | null;
    productId: string;
    quantity: number;
    // Fallback for legacy output rows with no recorded location; omitted =
    // default. Finished goods come back out of each output's recorded
    // location; ingredient restores follow each consumption's recorded location.
    locationId?: string | null;
    actorUserId: string | null;
    idempotencyKey?: string | null;
    notes?: string | null;
  }
) {
  const location = await resolveInventoryLocationInTx(
    tx,
    params.organizationId,
    params.locationId
  );
  // Planning is default-pinned in v1: the reversal re-adds demand/expected
  // at the default location where they were originally recorded, regardless
  // of where the physical legs happen.
  const planningLocation = await getDefaultInventoryLocationInTx(
    tx,
    params.organizationId
  );
  const existingOutputQuantity = await getOutputQuantityInTx(tx, {
    manufacturingOrderId: params.manufacturingOrderId,
    manufacturingOrderBatchId: params.manufacturingOrderBatchId,
  });

  if (params.quantity > existingOutputQuantity) {
    throw new ManufacturingError("Output cannot be reduced below zero.", 400);
  }

  const outputRows = await tx
    .select({
      id: manufacturingOrderOutputs.id,
      lotId: manufacturingOrderOutputs.lotId,
      locationId: manufacturingOrderOutputs.locationId,
      quantity: trimScale(manufacturingOrderOutputs.quantity).as("quantity"),
      reversedQuantity: trimScale(manufacturingOrderOutputs.reversedQuantity).as(
        "reversedQuantity"
      ),
      disposition: manufacturingOrderOutputs.disposition,
      unitCost: trimScale(manufacturingOrderOutputs.unitCost).as("unitCost"),
      materialCostTotal: trimScale(manufacturingOrderOutputs.materialCostTotal).as(
        "materialCostTotal"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, params.manufacturingOrderId),
        params.manufacturingOrderBatchId
          ? eq(manufacturingOrderOutputs.manufacturingOrderBatchId, params.manufacturingOrderBatchId)
          : sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NULL`,
        sql`${manufacturingOrderOutputs.quantity} > 0`
      )
    )
    .orderBy(desc(manufacturingOrderOutputs.outputNumber))
    .for("update");

  let remaining = params.quantity;
  let reversedMaterialCostTotal = 0;
  let reversalDisposition: Extract<InventoryDisposition, "available" | "blocked"> = "available";
  const reversedConsumptions = new Map<
    string,
    {
      quantity: number;
      cost: number;
      rows: Array<{
        outputId: string;
        lotId: string;
        locationId: string | null;
        quantity: number;
        costPerUnit: number;
      }>;
    }
  >();
  const outputConsumptionRows: Array<{
    manufacturingOrderIngredientId: string;
    lotId: string;
    locationId: string | null;
    quantityUsed: string;
    costPerUnit: string;
  }> = [];

  for (const output of outputRows) {
    if (remaining <= 0) break;

    // Each row tracks how much earlier reversals took from it, so attribution
    // survives outputs recorded after a reversal (walk-order replay doesn't).
    const outputQuantity = parseFloat(output.quantity);
    const availableQuantity = normalizeQuantityNumber(
      outputQuantity - parseFloat(output.reversedQuantity)
    );
    const reversedQuantity = normalizeQuantityNumber(
      Math.min(remaining, availableQuantity)
    );
    if (reversedQuantity <= 0) continue;

    reversalDisposition = output.disposition as Extract<
      InventoryDisposition,
      "available" | "blocked"
    >;
    const ratio = reversedQuantity / outputQuantity;
    const outputUnitCost = parseFloat(output.unitCost);
    reversedMaterialCostTotal += reversedQuantity * outputUnitCost;

    await decrementExistingLotStockInTx(tx, {
      organizationId: params.organizationId,
      locationId: output.locationId ?? location.id,
      itemId: params.productId,
      lotId: output.lotId,
      quantity: reversedQuantity,
      unitCost: output.unitCost,
      eventType: "manual_adjustment_decrease",
      eventSubtype: "manufacturing_output_reversal",
      referenceType: "manufacturing_order",
      referenceId: params.manufacturingOrderId,
      actorUserId: params.actorUserId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        params.idempotencyKey,
        `reverse-output:${output.id}`
      ),
      disposition: output.disposition as Extract<InventoryDisposition, "available" | "blocked">,
      metadata: { manufacturingOrderOutputId: output.id },
    });

    await tx
      .update(manufacturingOrderOutputs)
      .set({
        reversedQuantity: normalizeNumeric(
          normalizeQuantityNumber(
            parseFloat(output.reversedQuantity) + reversedQuantity
          )
        ),
      })
      .where(eq(manufacturingOrderOutputs.id, output.id));

    const consumptions = await tx
      .select({
        ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
        lotId: manufacturingOrderOutputConsumptions.lotId,
        locationId: manufacturingOrderOutputConsumptions.locationId,
        quantityUsed: trimScale(manufacturingOrderOutputConsumptions.quantityUsed).as(
          "quantityUsed"
        ),
        costPerUnit: trimScale(manufacturingOrderOutputConsumptions.costPerUnit).as(
          "costPerUnit"
        ),
      })
      .from(manufacturingOrderOutputConsumptions)
      .where(eq(manufacturingOrderOutputConsumptions.manufacturingOrderOutputId, output.id))
      .orderBy(asc(manufacturingOrderOutputConsumptions.id));

    for (const consumption of consumptions) {
      const quantity = normalizeQuantityNumber(parseFloat(consumption.quantityUsed) * ratio);
      if (quantity <= 0) continue;
      const costPerUnit = parseFloat(consumption.costPerUnit);
      const current = reversedConsumptions.get(consumption.ingredientId) ?? {
        quantity: 0,
        cost: 0,
        rows: [],
      };
      current.quantity = normalizeQuantityNumber(current.quantity + quantity);
      current.cost += quantity * costPerUnit;
      current.rows.push({
        outputId: output.id,
        lotId: consumption.lotId,
        locationId: consumption.locationId,
        quantity,
        costPerUnit,
      });
      reversedConsumptions.set(consumption.ingredientId, current);
      outputConsumptionRows.push({
        manufacturingOrderIngredientId: consumption.ingredientId,
        lotId: consumption.lotId,
        locationId: consumption.locationId ?? location.id,
        quantityUsed: normalizeNumeric(-quantity),
        costPerUnit: normalizeNumericScale(costPerUnit, 6),
      });
    }

    remaining = normalizeQuantityNumber(remaining - reversedQuantity);
  }

  if (remaining > 0) {
    throw new ManufacturingError("Output cannot be reduced below zero.", 400);
  }

  for (const [ingredientId, reversed] of reversedConsumptions) {
    const [ingredient] = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
        actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
          "actualQuantity"
        ),
        actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
          "actualCostTotal"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, ingredientId))
      .for("update");

    if (!ingredient) continue;

    for (const [rowIndex, row] of reversed.rows.entries()) {
      // Each consumption row records where it drew stock; legacy rows
      // (null) restore at the operation's location.
      await restockExistingLotInTx(tx, {
        organizationId: params.organizationId,
        locationId: row.locationId ?? location.id,
        itemId: ingredient.itemId,
        lotId: row.lotId,
        quantity: row.quantity,
        unitCost: normalizeNumericScale(row.costPerUnit, 6),
        eventType: "manufacturing_variance_gain",
        eventSubtype: "manufacturing_output_reversal",
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        actorUserId: params.actorUserId,
        // Location and row index are part of the key: the same
        // output/ingredient/lot can have several consumption rows, each
        // restored separately.
        idempotencyKey: deriveInventoryIdempotencyKey(
          params.idempotencyKey,
          `reverse-consume:${row.outputId}:${ingredientId}:${row.lotId}:${row.locationId ?? location.id}:${rowIndex}`
        ),
        metadata: { manufacturingOrderIngredientId: ingredientId },
      });
    }

    // The restocks above return stock that pick-allocation rows still claim.
    // Settle those rows in step, or the next completion counts them as
    // consumed again on top of its fresh consumption. Within a lot/location
    // bucket, layers settle by recorded cost first, oldest-first — the same
    // attribution order completion uses — so a partial reversal releases the
    // layer whose cost the reversed consumption actually recorded; layers
    // without a cost match (legacy rows) fall back oldest-first.
    const reversedByLotAndLocation = new Map<
      string,
      { lotId: string; locationId: string; layers: Map<string, number> }
    >();
    for (const row of reversed.rows) {
      const locationId = row.locationId ?? location.id;
      const key = `${row.lotId}:${locationId}`;
      const bucket = reversedByLotAndLocation.get(key) ?? {
        lotId: row.lotId,
        locationId,
        layers: new Map<string, number>(),
      };
      const costKey = normalizeNumericScale(row.costPerUnit, 6);
      bucket.layers.set(
        costKey,
        normalizeQuantityNumber((bucket.layers.get(costKey) ?? 0) + row.quantity)
      );
      reversedByLotAndLocation.set(key, bucket);
    }
    for (const reversedAtLocation of reversedByLotAndLocation.values()) {
      const allocationRows = await tx
        .select({
          id: manufacturingPickAllocations.id,
          quantityUsed: trimScale(manufacturingPickAllocations.quantityUsed).as(
            "quantityUsed"
          ),
          costPerUnit: trimScaleNullable(manufacturingPickAllocations.costPerUnit).as(
            "costPerUnit"
          ),
        })
        .from(manufacturingPickAllocations)
        .where(
          and(
            eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredientId),
            eq(manufacturingPickAllocations.lotId, reversedAtLocation.lotId),
            reversedAtLocation.locationId === planningLocation.id
              ? or(
                  eq(manufacturingPickAllocations.locationId, planningLocation.id),
                  sql`${manufacturingPickAllocations.locationId} IS NULL`
                )
              : eq(manufacturingPickAllocations.locationId, reversedAtLocation.locationId)
          )
        )
        .orderBy(asc(manufacturingPickAllocations.createdAt), asc(manufacturingPickAllocations.id))
        .for("update");
      const allocations = allocationRows.map((row) => ({
        id: row.id,
        originalQuantity: parseFloat(row.quantityUsed),
        remaining: parseFloat(row.quantityUsed),
        costKey:
          row.costPerUnit == null
            ? null
            : normalizeNumericScale(parseFloat(row.costPerUnit), 6),
      }));

      let unmatched = 0;
      for (const [costKey, layerQuantity] of reversedAtLocation.layers) {
        let remainingToRelease = layerQuantity;
        for (const allocation of allocations) {
          if (remainingToRelease <= 0) break;
          if (allocation.costKey !== costKey || allocation.remaining <= 0) continue;
          const released = normalizeQuantityNumber(
            Math.min(remainingToRelease, allocation.remaining)
          );
          if (released <= 0) continue;
          allocation.remaining = normalizeQuantityNumber(allocation.remaining - released);
          remainingToRelease = normalizeQuantityNumber(remainingToRelease - released);
        }
        unmatched = normalizeQuantityNumber(unmatched + remainingToRelease);
      }
      let remainingToRelease = unmatched;
      for (const allocation of allocations) {
        if (remainingToRelease <= 0) break;
        if (allocation.remaining <= 0) continue;
        const released = normalizeQuantityNumber(
          Math.min(remainingToRelease, allocation.remaining)
        );
        if (released <= 0) continue;
        allocation.remaining = normalizeQuantityNumber(allocation.remaining - released);
        remainingToRelease = normalizeQuantityNumber(remainingToRelease - released);
      }

      for (const allocation of allocations) {
        if (allocation.remaining >= allocation.originalQuantity) continue;
        if (allocation.remaining <= 0) {
          await tx
            .delete(manufacturingPickAllocations)
            .where(eq(manufacturingPickAllocations.id, allocation.id));
        } else {
          await tx
            .update(manufacturingPickAllocations)
            .set({ quantityUsed: normalizeNumeric(allocation.remaining) })
            .where(eq(manufacturingPickAllocations.id, allocation.id));
        }
      }
    }

    const nextActualQuantity = Math.max(
      0,
      parseFloat(ingredient.actualQuantity ?? "0") - reversed.quantity
    );
    const nextPickedQuantity = Math.max(
      0,
      parseFloat(ingredient.pickedQuantity) - reversed.quantity
    );
    const plannedQuantity = parseFloat(ingredient.plannedQuantity);
    await tx
      .update(manufacturingOrderIngredients)
      .set({
        actualQuantity: normalizeNumeric(nextActualQuantity),
        actualCostTotal: normalizeNumeric(
          Math.max(0, parseFloat(ingredient.actualCostTotal ?? "0") - reversed.cost)
        ),
        pickedQuantity: normalizeNumeric(nextPickedQuantity),
        pickStatus:
          nextPickedQuantity <= 0
            ? "not_picked"
            : nextPickedQuantity >= plannedQuantity
              ? "picked"
              : "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderIngredients.id, ingredientId));

    await applyDemandReferenceDeltasInTx(tx, {
      organizationId: params.organizationId,
      locationId: planningLocation.id,
      actorUserId: params.actorUserId,
      eventSubtype: "manufacturing_output_reversal",
      deltas: [
        {
          itemId: ingredient.itemId,
          referenceType: "manufacturing_order_ingredient",
          referenceId: ingredientId,
          quantity: reversed.quantity,
        },
      ],
    });
  }

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: planningLocation.id,
    actorUserId: params.actorUserId,
    eventSubtype: "manufacturing_output_reversal",
    deltas: [
      {
        itemId: params.productId,
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        quantity: params.quantity,
      },
    ],
  });

  const lotId = await getProducedLotIdInTx(
    tx,
    params.manufacturingOrderId,
    params.manufacturingOrderBatchId
  );
  if (!lotId) {
    throw new ManufacturingError("Produced lot not found.", 400);
  }

  const [output] = await tx
    .insert(manufacturingOrderOutputs)
    .values({
      manufacturingOrderId: params.manufacturingOrderId,
      manufacturingOrderBatchId: params.manufacturingOrderBatchId,
      lotId,
      // A reversal can span outputs at several locations; markers stay
      // unlocated and are never walked (quantity <= 0).
      locationId: null,
      outputNumber: await nextOutputNumberInTx(tx, params.manufacturingOrderId),
      quantity: normalizeNumeric(-params.quantity),
      disposition: reversalDisposition,
      unitCost:
        params.quantity > 0
          ? normalizeNumericScale(reversedMaterialCostTotal / params.quantity, 6)
          : "0",
      materialCostTotal: normalizeNumericScale(-reversedMaterialCostTotal, 6),
      notes: params.notes,
      createdBy: params.actorUserId ?? "system",
    })
    .returning({ id: manufacturingOrderOutputs.id });

  if (outputConsumptionRows.length > 0) {
    await tx.insert(manufacturingOrderOutputConsumptions).values(
      outputConsumptionRows.map((row) => ({
        manufacturingOrderOutputId: output.id,
        ...row,
      }))
    );
  }
}

export async function recomputeManufacturingActualRollupsInTx(
  tx: Tx,
  orderId: string,
  options?: { batchId?: string | null }
) {
  const allOutputs = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
      materialCostTotal: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputs.materialCostTotal}), 0)`
      ).as("materialCostTotal"),
    })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
  const totalActualQuantity = parseFloat(allOutputs[0]?.quantity ?? "0");
  const totalMaterialCost = parseFloat(allOutputs[0]?.materialCostTotal ?? "0");
  const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
    tx,
    orderId,
    totalActualQuantity
  );
  if (options?.batchId) {
    const batchOutputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: options.batchId,
    });
    await tx
      .update(manufacturingOrderBatches)
      .set({
        actualQuantity: normalizeNumeric(batchOutputQuantity),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderBatches.id, options.batchId));
  }
  await tx
    .update(manufacturingOrders)
    .set({
      actualQuantity: normalizeNumeric(totalActualQuantity),
      actualMaterialCost: normalizeNumeric(totalMaterialCost),
      actualOperationsCost: normalizeNumericScale(totalOperationsCost, 6),
      actualCostPerUnit:
        totalActualQuantity > 0
          ? normalizeNumeric((totalMaterialCost + totalOperationsCost) / totalActualQuantity)
          : null,
      updatedAt: new Date(),
    })
    .where(eq(manufacturingOrders.id, orderId));
}

export async function recordManufacturingOutput(
  orderId: string,
  payload: RecordManufacturingOutput,
  options?: { idempotencyKey?: string; batchId?: string | null }
): Promise<{ id: string; lotId: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string; lotId: string }>(tx, {
      organizationId: orgId,
      operationName: "recordManufacturingOutput",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, payload, batchId: options?.batchId ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);
    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can record output", 400);
    }

    if (
      payload.outputDisposition !== "available" &&
      (await getItemLotTrackingModeInTx(tx, order.productId)) === "untracked"
    ) {
      throw new ManufacturingError(
        "Untracked items can only be produced as available.",
        400
      );
    }

    // Producing into a non-available disposition creates a blocked lot — the
    // lot_tracking paid state. Recording output as available is always free.
    if (payload.outputDisposition !== "available") {
      await assertFeatureAccessInTx(tx, orgId, "lot_tracking", {
        route: "POST /api/manufacturing-orders/[id]/outputs",
      });
    }

    const outputQuantity = Number(payload.quantity);
    if (outputQuantity < 0) {
      await reverseManufacturingOutputInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: orderId,
        manufacturingOrderBatchId: options?.batchId ?? null,
        productId: order.productId,
        quantity: Math.abs(outputQuantity),
        locationId: payload.locationId,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey,
        notes: payload.notes,
      });

      await recomputeManufacturingActualRollupsInTx(tx, orderId, {
        batchId: options?.batchId ?? null,
      });

      const result = {
        id: orderId,
        lotId:
          (await getProducedLotIdInTx(tx, orderId, options?.batchId ?? null)) ?? "",
      };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });

      return result;
    }

    let batch: LockedBatchStateRow | null = null;
    let plannedOutputQuantity = parseFloat(
      (
        await tx
          .select({
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
          })
          .from(manufacturingOrders)
          .where(eq(manufacturingOrders.id, orderId))
      )[0]?.plannedQuantity ?? "0"
    );

    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      const batches = await getLockedBatchStateRowsInTx(tx, orderId);
      batch = options?.batchId
        ? batches.find((row) => row.id === options.batchId) ?? null
        : getCurrentExecutionBatch(batches);
      if (!batch) {
        throw new ManufacturingError("Batch not found", 404);
      }
      assertCurrentExecutionBatch(batches, batch.id, "started");
      const [batchQuantity] = await tx
        .select({
          plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
            "plannedQuantity"
          ),
        })
        .from(manufacturingOrderBatches)
        .where(eq(manufacturingOrderBatches.id, batch.id));
      plannedOutputQuantity = parseFloat(batchQuantity?.plannedQuantity ?? "0");

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
    } else if (options?.batchId) {
      throw new ManufacturingError("Discrete orders cannot record batch output.", 400);
    }

    if (plannedOutputQuantity <= 0) {
      throw new ManufacturingError("Planned output quantity is invalid.", 400);
    }

    const existingOutputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batch?.id ?? null,
    });
    await assertLinkedMtoOutputWithinSalesDemandInTx(
      tx,
      order,
      outputQuantity
    );

    const ingredientRows =
      batch != null
        ? await getBatchIngredientsInTx(tx, batch.id)
        : await getTemplateIngredientsInTx(tx, orderId);
    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );
    const outputConsumedByIngredient = await getConsumedQuantityByIngredientInTx(
      tx,
      ingredientRows.map((row) => row.id)
    );
    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      ingredientRows.map((row) => row.id)
    );
    const ratio = outputQuantity / plannedOutputQuantity;
    // Physical legs (auto-consume, produce) follow the requested location;
    // planning legs stay default-pinned in v1.
    const location = await resolveInventoryLocationInTx(tx, orgId, payload.locationId);
    const planningLocation = await getDefaultInventoryLocationInTx(tx, orgId);
    const outputConsumptionRows: Array<{
      manufacturingOrderIngredientId: string;
      lotId: string;
      locationId: string | null;
      quantityUsed: string;
      costPerUnit: string;
    }> = [];
    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const plannedIngredientQuantity = parseFloat(ingredient.plannedQuantity);
      const alreadyOutputConsumed = outputConsumedByIngredient.get(ingredient.id) ?? 0;
      const requiredQuantity = normalizeQuantityNumber(
        plannedIngredientQuantity * ratio
      );
      if (requiredQuantity <= 0) {
        continue;
      }

      let actualCostTotal = 0;
      let remainingRequiredQuantity = requiredQuantity;
      let skippedPickedQuantity = alreadyOutputConsumed;
      const pickedAllocations = pickAllocationsByIngredient.get(ingredient.id) ?? [];

      for (const allocation of pickedAllocations) {
        if (remainingRequiredQuantity <= 0) {
          break;
        }

        const allocationQuantity = parseFloat(allocation.quantityUsed);
        if (skippedPickedQuantity >= allocationQuantity) {
          skippedPickedQuantity = normalizeQuantityNumber(
            skippedPickedQuantity - allocationQuantity
          );
          continue;
        }

        const availablePickedQuantity = normalizeQuantityNumber(
          allocationQuantity - skippedPickedQuantity
        );
        skippedPickedQuantity = 0;
        const quantityUsed = normalizeQuantityNumber(
          Math.min(remainingRequiredQuantity, availablePickedQuantity)
        );
        if (quantityUsed <= 0) {
          continue;
        }

        const costPerUnit = allocation.costPerUnit != null ? parseFloat(allocation.costPerUnit) : 0;
        actualCostTotal += quantityUsed * costPerUnit;
        remainingRequiredQuantity = normalizeQuantityNumber(
          remainingRequiredQuantity - quantityUsed
        );
        outputConsumptionRows.push({
          manufacturingOrderIngredientId: ingredient.id,
          lotId: allocation.lotId,
          locationId: allocation.locationId,
          quantityUsed: normalizeNumericScale(quantityUsed, 4),
          costPerUnit: normalizeNumericScale(costPerUnit, 6),
        });
      }

      if (remainingRequiredQuantity > 0) {
        const consumeIdempotencyKey = deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `consume:${ingredient.id}`
        );
        let consumed: Awaited<ReturnType<typeof consumeStockFifoInTx>>;
        try {
          consumed = await consumeStockFifoInTx(tx, {
            organizationId: orgId,
            locationId: location.id,
            itemId: ingredient.itemId,
            quantity: remainingRequiredQuantity,
            eventType: "manufacturing_ingredient_consumption",
            eventSubtype: "manufacturing_output",
            referenceType: batch != null ? "manufacturing_batch" : "manufacturing_order",
            referenceId: batch?.id ?? orderId,
            actorUserId: userId,
            idempotencyKey: consumeIdempotencyKey,
            metadata: { manufacturingOrderIngredientId: ingredient.id },
            unavailableByLotId: new Map(),
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
        for (const allocation of consumed.allocations) {
          actualCostTotal += allocation.quantity * allocation.unitCost;
          outputConsumptionRows.push({
            manufacturingOrderIngredientId: ingredient.id,
            lotId: allocation.lotId,
            locationId: location.id,
            quantityUsed: normalizeNumericScale(allocation.quantity, 4),
            costPerUnit: normalizeNumericScale(allocation.unitCost, 6),
          });
        }
      }

      const autoConsumedQuantity = normalizeQuantityNumber(
        remainingRequiredQuantity > 0 ? remainingRequiredQuantity : 0
      );
      const nextActualQuantity = alreadyOutputConsumed + requiredQuantity;
      const nextPickedQuantity = Math.max(
        parseFloat(ingredient.pickedQuantity),
        nextActualQuantity
      );
      const nextActualCostTotal =
        parseFloat(ingredient.actualCostTotal ?? "0") + actualCostTotal;
      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeNumeric(nextActualQuantity),
          actualCostTotal: normalizeNumeric(nextActualCostTotal),
          pickedQuantity: normalizeNumeric(nextPickedQuantity),
          pickStatus:
            nextPickedQuantity >= plannedIngredientQuantity ? "picked" : "in_progress",
          pickedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));

      produceIngredientRows.push({
        ingredientId: ingredient.id,
        actualQuantity: requiredQuantity,
        actualCostTotal,
      });

      if (autoConsumedQuantity <= 0) {
        continue;
      }

      await applyDemandReferenceDeltasInTx(tx, {
        organizationId: orgId,
        locationId: planningLocation.id,
        actorUserId: userId,
        eventSubtype: "manufacturing_output",
        deltas: [
          {
            itemId: ingredient.itemId,
            referenceType: "manufacturing_order_ingredient",
            referenceId: ingredient.id,
            quantity: -autoConsumedQuantity,
          },
        ],
      });
    }

    const materialCostTotal = produceIngredientRows.reduce(
      (sum, ingredient) => sum + ingredient.actualCostTotal,
      0
    );
    const existingOrderOutputQuantity = await getTotalOutputQuantityForOrderInTx(
      tx,
      orderId
    );
    const absorbedOperationCost = await getIncrementalAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      existingOrderOutputQuantity,
      outputQuantity
    );
    const targetLot = await resolveProducedLotForUnitInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: options?.batchId ?? null,
      productId: order.productId,
      selection: payload,
    });
    const produced = await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      productId: order.productId,
      quantity: outputQuantity,
      locationId: payload.locationId,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      lotId: targetLot.lotId,
      newLotNumber: targetLot.newLotNumber,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "output-lot"
      ),
      expectedReleaseQuantity: outputQuantity,
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });

    const output = await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batch?.id ?? null,
      lotId: produced.lotId,
      locationId: location.id,
      quantity: outputQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal,
      notes: payload.notes,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
    });

    const updatedActualQuantity = normalizeQuantityNumber(
      existingOutputQuantity + outputQuantity
    );
    if (batch != null) {
      await tx
        .update(manufacturingOrderBatches)
        .set({
          actualQuantity: normalizeNumeric(updatedActualQuantity),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batch.id));
    }

    const allOutputs = await tx
      .select({
        quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
          "quantity"
        ),
        materialCostTotal: trimScale(
          sql`COALESCE(SUM(${manufacturingOrderOutputs.materialCostTotal}), 0)`
        ).as("materialCostTotal"),
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    const totalActualQuantity = parseFloat(allOutputs[0]?.quantity ?? "0");
    const totalMaterialCost = parseFloat(allOutputs[0]?.materialCostTotal ?? "0");
    const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      totalActualQuantity
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
            : null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, orderId));

    const result = { id: output.id, lotId: produced.lotId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
