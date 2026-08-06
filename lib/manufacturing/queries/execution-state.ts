import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { itemFamilies, items, lots, manufacturingOrderBatches, manufacturingOrderOutputConsumptions, manufacturingOrderOutputs, manufacturingOrderIngredientConstraints, manufacturingOrderIngredients, manufacturingPickAllocations } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeQuantityNumber, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { projectedLotUnitCost } from "@/lib/inventory/kernel";
import type { BomComponentConstraint } from "@/lib/bom/constraints";
import { buildFifoLotPickPlanInTx, type LotPickPlanEntry } from "@/lib/inventory/lot-pick-plan";
import type { ManufacturingBatchStatus, ManufacturingLotStrategy, ManufacturingPickStatus } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingOrderIngredientDetail, ManufacturingPickProgressStatus } from "../types";
import { ManufacturingError } from "./errors";
import { type LockedManufacturingOrder, getPickProgressStatus, getRemainingQuantityNumber, sumNumericStrings } from "./shared";

export type ExecutionIngredientRow = {
  id: string;
  manufacturingOrderBatchId: string | null;
  bomRevisionComponentId: string | null;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  plannedQuantity: string;
  lotStrategy: ManufacturingLotStrategy;
  pickedQuantity: string;
  pickStatus: ManufacturingPickStatus;
  actualQuantity: string | null;
  actualCostTotal: string | null;
  sortOrder: number;
  constraints: BomComponentConstraint[];
};

type ExecutionIngredientLotAllocation = NonNullable<
  ManufacturingOrderIngredientDetail["lotAllocations"]
>[number];

export type ExecutionBatchRow = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  plannedQuantity: string;
  actualQuantity: string | null;
  startedAt: Date | null;
  pickedAt: Date | null;
  completedAt: Date | null;
  lotId: string | null;
  lotNumber: string | null;
  costPerUnit: string | null;
};

export type LockedBatchStateRow = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  pickedAt: Date | null;
};

export function getCurrentExecutionBatch<T extends { id: string; batchNumber: number; status: string }>(
  batches: T[]
) {
  return batches.find((batch) => batch.status !== "completed") ?? null;
}

export function assertCurrentExecutionBatch<T extends { id: string; batchNumber: number; status: string }>(
  batches: T[],
  batchId: string,
  action: "started" | "picked" | "completed"
) {
  const currentBatch = getCurrentExecutionBatch(batches);

  if (!currentBatch) {
    throw new ManufacturingError("All batches are already completed", 400);
  }

  if (currentBatch.id !== batchId) {
    throw new ManufacturingError(
      `Only batch ${currentBatch.batchNumber} can be ${action} right now.`,
      400
    );
  }

  return currentBatch;
}

function getRemainingQuantityString(plannedQuantity: string, pickedQuantity: string) {
  return normalizeNumeric(getRemainingQuantityNumber(plannedQuantity, pickedQuantity));
}

export async function getIngredientConstraintsByIdInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, BomComponentConstraint[]>();
  }

  const rows = await tx
    .select({
      id: manufacturingOrderIngredientConstraints.id,
      manufacturingOrderIngredientId:
        manufacturingOrderIngredientConstraints.manufacturingOrderIngredientId,
      constraintType: manufacturingOrderIngredientConstraints.constraintType,
      config: manufacturingOrderIngredientConstraints.config,
      sortOrder: manufacturingOrderIngredientConstraints.sortOrder,
    })
    .from(manufacturingOrderIngredientConstraints)
    .where(
      inArray(
        manufacturingOrderIngredientConstraints.manufacturingOrderIngredientId,
        uniqueIds
      )
    )
    .orderBy(
      asc(manufacturingOrderIngredientConstraints.sortOrder),
      asc(manufacturingOrderIngredientConstraints.createdAt)
    );

  const result = new Map<string, BomComponentConstraint[]>();
  for (const row of rows) {
    const bucket = result.get(row.manufacturingOrderIngredientId) ?? [];
    bucket.push({
      id: row.id,
      constraintType: row.constraintType as BomComponentConstraint["constraintType"],
      config: row.config,
      sortOrder: row.sortOrder,
    });
    result.set(row.manufacturingOrderIngredientId, bucket);
  }

  return result;
}

export async function getTemplateIngredientsInTx(tx: Tx, orderId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
        "quantityPerUnit"
      ),
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
        "actualCostTotal"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, orderId),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const constraintsById = await getIngredientConstraintsByIdInTx(
    tx,
    rows.map((row) => row.id)
  );

  return rows.map((row) => ({
    ...row,
    pickStatus: row.pickStatus as ManufacturingPickStatus,
    lotStrategy: row.lotStrategy as ManufacturingLotStrategy,
    constraints: constraintsById.get(row.id) ?? [],
  }));
}

export async function getBatchIngredientsInTx(tx: Tx, batchId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
        "quantityPerUnit"
      ),
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
        "actualCostTotal"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderBatchId, batchId))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const constraintsById = await getIngredientConstraintsByIdInTx(
    tx,
    rows.map((row) => row.id)
  );

  return rows.map((row) => ({
    ...row,
    pickStatus: row.pickStatus as ManufacturingPickStatus,
    lotStrategy: row.lotStrategy as ManufacturingLotStrategy,
    constraints: constraintsById.get(row.id) ?? [],
  }));
}

export async function getBatchRowsInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      status: manufacturingOrderBatches.status,
      plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
        "plannedQuantity"
      ),
      actualQuantity: trimScaleNullable(manufacturingOrderBatches.actualQuantity).as(
        "actualQuantity"
      ),
      startedAt: manufacturingOrderBatches.startedAt,
      pickedAt: manufacturingOrderBatches.pickedAt,
      completedAt: manufacturingOrderBatches.completedAt,
      lotId: manufacturingOrderBatches.lotId,
      lotNumber: lots.lotNumber,
      costPerUnit: projectedLotUnitCost(lots.organizationId, lots.id).as("costPerUnit"),
    })
    .from(manufacturingOrderBatches)
    .leftJoin(lots, eq(manufacturingOrderBatches.lotId, lots.id))
    .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderBatches.batchNumber)) as Promise<ExecutionBatchRow[]>;
}

export async function getLockedBatchStateRowsInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      status: manufacturingOrderBatches.status,
      pickedAt: manufacturingOrderBatches.pickedAt,
    })
    .from(manufacturingOrderBatches)
    .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderBatches.batchNumber))
    .for("update") as Promise<LockedBatchStateRow[]>;
}

export async function ensureBatchExecutionRowsInTx(
  tx: Tx,
  order: LockedManufacturingOrder
): Promise<ExecutionBatchRow[]> {
  if (
    order.manufacturingMode !== "batch" ||
    order.status !== "open"
  ) {
    return [];
  }

  const existingBatches = await getBatchRowsInTx(tx, order.id);
  if (existingBatches.length > 0) {
    return existingBatches;
  }

  if (order.numberOfBatches == null || order.expectedBatchYield == null) {
    throw new ManufacturingError("Batch orders require batch planning metadata", 400);
  }

  const templateIngredients = await getTemplateIngredientsInTx(tx, order.id);
  if (templateIngredients.length === 0) {
    return [];
  }

  const expectedBatchYield = parseFloat(order.expectedBatchYield);
  const plannedOutputQuantity = parseFloat(order.plannedQuantity);
  let remainingOutputQuantity = plannedOutputQuantity;

  const batchRows = Array.from({ length: order.numberOfBatches }, (_, index) => {
    const plannedQuantity =
      index === order.numberOfBatches! - 1
        ? remainingOutputQuantity
        : Math.min(expectedBatchYield, remainingOutputQuantity);
    remainingOutputQuantity = normalizeQuantityNumber(
      remainingOutputQuantity - plannedQuantity
    );

    return {
      manufacturingOrderId: order.id,
      batchNumber: index + 1,
      plannedQuantity: normalizeNumeric(plannedQuantity),
    };
  });

  const insertedBatches = await tx
    .insert(manufacturingOrderBatches)
    .values(batchRows)
    .returning({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
        "plannedQuantity"
      ),
    });

  const batchIngredientInputs = insertedBatches.flatMap((batch) =>
    templateIngredients.map((ingredient) => {
      return {
        constraints: ingredient.constraints,
        values: {
          manufacturingOrderId: order.id,
          manufacturingOrderBatchId: batch.id,
          bomRevisionComponentId: ingredient.bomRevisionComponentId,
          itemId: ingredient.itemId,
          itemName: ingredient.itemName,
          itemSku: ingredient.itemSku,
          itemType: ingredient.itemType,
          unitName: ingredient.unitName,
          quantityPerUnit: ingredient.quantityPerUnit,
          plannedQuantity: ingredient.quantityPerUnit,
          sortOrder: ingredient.sortOrder,
        },
      };
    })
  );

  const insertedIngredients = await tx
    .insert(manufacturingOrderIngredients)
    .values(batchIngredientInputs.map((entry) => entry.values))
    .returning({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      itemId: manufacturingOrderIngredients.itemId,
      sortOrder: manufacturingOrderIngredients.sortOrder,
    });

  const constraintRows = insertedIngredients.flatMap((ingredient) =>
    (batchIngredientInputs.find(
      (input) =>
        input.values.manufacturingOrderBatchId ===
          ingredient.manufacturingOrderBatchId &&
        input.values.itemId === ingredient.itemId &&
        input.values.sortOrder === ingredient.sortOrder
    )?.constraints ?? []).map((constraint) => ({
      manufacturingOrderIngredientId: ingredient.id,
      constraintType: constraint.constraintType,
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    }))
  );

  if (constraintRows.length > 0) {
    await tx.insert(manufacturingOrderIngredientConstraints).values(constraintRows);
  }

  await tx
    .delete(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, order.id),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    );

  return getBatchRowsInTx(tx, order.id);
}

export async function getOutputQuantityInTx(
  tx: Tx,
  params: {
    manufacturingOrderId: string;
    manufacturingOrderBatchId?: string | null;
  }
) {
  const [row] = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, params.manufacturingOrderId),
        params.manufacturingOrderBatchId
          ? eq(manufacturingOrderOutputs.manufacturingOrderBatchId, params.manufacturingOrderBatchId)
          : sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NULL`
      )
    );

  return parseFloat(row?.quantity ?? "0");
}

/**
 * The lot a production unit's output already lives in. A unit is a single batch
 * (batchId set) or — for discrete MOs — the whole order (batchId null, matching
 * the always-null batch column on discrete outputs). Scoping by batch is what
 * keeps each batch in its own lot rather than collapsing into the first one
 * (ERP-169).
 */
export async function getProducedLotIdInTx(
  tx: Tx,
  manufacturingOrderId: string,
  manufacturingOrderBatchId: string | null = null
) {
  const [row] = await tx
    .select({ lotId: manufacturingOrderOutputs.lotId })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId),
        manufacturingOrderBatchId
          ? eq(
              manufacturingOrderOutputs.manufacturingOrderBatchId,
              manufacturingOrderBatchId
            )
          : sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NULL`
      )
    )
    .orderBy(asc(manufacturingOrderOutputs.outputNumber))
    .limit(1)
    .for("update");

  return row?.lotId ?? null;
}

type ProducedLotSelection = {
  producedLotId?: string | null;
  producedLotNumber?: string | null;
};

/**
 * Decide which lot a unit's output should land in (ERP-169). A unit — one batch,
 * or a whole discrete MO — is exactly one lot: once any output exists for it,
 * that lot is reused and the caller's selection is ignored. Before then, the
 * caller may append to an existing lot of the same product (`producedLotId`) or
 * name a new one (`producedLotNumber`); absent both, a date lot is generated.
 */
export async function resolveProducedLotForUnitInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    manufacturingOrderBatchId: string | null;
    productId: string;
    selection?: ProducedLotSelection;
  }
): Promise<{ lotId: string | null; newLotNumber: string | null }> {
  const existingLotId = await getProducedLotIdInTx(
    tx,
    params.manufacturingOrderId,
    params.manufacturingOrderBatchId
  );
  if (existingLotId) {
    return { lotId: existingLotId, newLotNumber: null };
  }

  const requestedLotId = params.selection?.producedLotId?.trim() || null;
  if (requestedLotId) {
    const [lot] = await tx
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.id, requestedLotId),
          eq(lots.organizationId, params.organizationId),
          eq(lots.itemId, params.productId)
        )
      )
      .for("update");
    if (!lot) {
      throw new ManufacturingError(
        "Selected lot is not valid for this product.",
        400
      );
    }
    return { lotId: lot.id, newLotNumber: null };
  }

  const requestedLotNumber = params.selection?.producedLotNumber?.trim() || null;
  if (requestedLotNumber) {
    const [clash] = await tx
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, params.organizationId),
          eq(lots.itemId, params.productId),
          eq(lots.lotNumber, requestedLotNumber)
        )
      )
      .for("update");
    if (clash) {
      throw new ManufacturingError(
        `Lot ${requestedLotNumber} already exists for this product. Choose it as an existing lot or use a different number.`,
        400
      );
    }
  }

  return { lotId: null, newLotNumber: requestedLotNumber };
}

export async function getPickAllocationsByIngredientInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<
      string,
      Array<{
        lotId: string;
        locationId: string | null;
        quantityUsed: string;
        costPerUnit: string | null;
      }>
    >();
  }

  const rows = await tx
    .select({
      manufacturingOrderIngredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      lotId: manufacturingPickAllocations.lotId,
      locationId: manufacturingPickAllocations.locationId,
      quantityUsed: trimScale(manufacturingPickAllocations.quantityUsed).as("quantityUsed"),
      costPerUnit: trimScaleNullable(manufacturingPickAllocations.costPerUnit).as(
        "costPerUnit"
      ),
    })
    .from(manufacturingPickAllocations)
    .where(
      inArray(manufacturingPickAllocations.manufacturingOrderIngredientId, uniqueIds)
    )
    .orderBy(asc(manufacturingPickAllocations.createdAt), asc(manufacturingPickAllocations.id));

  const allocations = new Map<
    string,
    Array<{
      lotId: string;
      locationId: string | null;
      quantityUsed: string;
      costPerUnit: string | null;
    }>
  >();

  for (const row of rows) {
    const ingredientAllocations = allocations.get(row.manufacturingOrderIngredientId) ?? [];
    ingredientAllocations.push({
      lotId: row.lotId,
      locationId: row.locationId,
      quantityUsed: row.quantityUsed,
      costPerUnit: row.costPerUnit,
    });
    allocations.set(row.manufacturingOrderIngredientId, ingredientAllocations);
  }

  return allocations;
}

export function toIngredientDetail(ingredient: ExecutionIngredientRow): ManufacturingOrderIngredientDetail {
  return {
    ...ingredient,
    lotTrackingMode: "tracked",
    remainingQuantity: getRemainingQuantityString(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    ),
    defaultItemId: null,
    defaultItemName: null,
    defaultItemSku: null,
    defaultUnitName: null,
    defaultQuantityPerUnit: null,
    siblingVariants: [],
    alternates: [],
  };
}

async function getLotTrackedItemIdsInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return new Set<string>();

  const rows = await tx
    .select({ itemId: items.id })
    .from(items)
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(
      and(
        inArray(items.id, uniqueItemIds),
        eq(itemFamilies.lotTrackingMode, "tracked")
      )
    );

  return new Set(rows.map((row) => row.itemId));
}

async function getLotTrackingModeByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  const modes = new Map<string, "tracked" | "untracked">();
  if (uniqueItemIds.length === 0) return modes;

  const rows = await tx
    .select({
      itemId: items.id,
      lotTrackingMode: itemFamilies.lotTrackingMode,
    })
    .from(items)
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(inArray(items.id, uniqueItemIds));

  for (const row of rows) {
    modes.set(
      row.itemId,
      row.lotTrackingMode === "untracked" ? "untracked" : "tracked"
    );
  }

  return modes;
}

export async function withIngredientLotTrackingModesInTx<
  T extends { itemId: string },
>(tx: Tx, ingredients: T[]) {
  const modes = await getLotTrackingModeByItemIdInTx(
    tx,
    ingredients.map((ingredient) => ingredient.itemId)
  );

  return ingredients.map((ingredient) => ({
    ...ingredient,
    lotTrackingMode: modes.get(ingredient.itemId) ?? "tracked",
  }));
}

export async function getExecutionLotAllocationsByIngredientInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  const allocations = new Map<string, ExecutionIngredientLotAllocation[]>();
  if (uniqueIds.length === 0) {
    return allocations;
  }

  const trackedIngredientRows = await tx
    .select({ id: manufacturingOrderIngredients.id })
    .from(manufacturingOrderIngredients)
    .innerJoin(items, eq(items.id, manufacturingOrderIngredients.itemId))
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(
      and(
        inArray(manufacturingOrderIngredients.id, uniqueIds),
        eq(itemFamilies.lotTrackingMode, "tracked")
      )
    );
  const trackedIngredientIds = trackedIngredientRows.map((row) => row.id);
  if (trackedIngredientIds.length === 0) {
    return allocations;
  }

  const consumedRows = await tx
    .select({
      ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      lotId: manufacturingOrderOutputConsumptions.lotId,
      lotNumber: lots.lotNumber,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputConsumptions.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderOutputConsumptions)
    .innerJoin(lots, eq(manufacturingOrderOutputConsumptions.lotId, lots.id))
    .where(
      inArray(
        manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
        trackedIngredientIds
      )
    )
    .groupBy(
      manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      manufacturingOrderOutputConsumptions.lotId,
      lots.lotNumber
    )
    .orderBy(asc(lots.lotNumber));

  for (const row of consumedRows) {
    const rows = allocations.get(row.ingredientId) ?? [];
    rows.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: row.quantity,
      sourceType: "consumed",
      sourceId: row.lotId,
      sourceLabel: row.lotNumber,
    });
    allocations.set(row.ingredientId, rows);
  }

  const unconsumedIngredientIds = trackedIngredientIds.filter((id) => !allocations.has(id));
  if (unconsumedIngredientIds.length === 0) {
    return allocations;
  }

  const pickedRows = await tx
    .select({
      ingredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      lotId: manufacturingPickAllocations.lotId,
      lotNumber: lots.lotNumber,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingPickAllocations.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingPickAllocations)
    .innerJoin(lots, eq(manufacturingPickAllocations.lotId, lots.id))
    .where(
      inArray(
        manufacturingPickAllocations.manufacturingOrderIngredientId,
        unconsumedIngredientIds
      )
    )
    .groupBy(
      manufacturingPickAllocations.manufacturingOrderIngredientId,
      manufacturingPickAllocations.lotId,
      lots.lotNumber
    )
    .orderBy(asc(lots.lotNumber));

  for (const row of pickedRows) {
    const rows = allocations.get(row.ingredientId) ?? [];
    rows.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: row.quantity,
      sourceType: "picked",
      sourceId: row.lotId,
      sourceLabel: row.lotNumber,
    });
    allocations.set(row.ingredientId, rows);
  }

  return allocations;
}

export async function getExecutionLotPickPlansByIngredientInTx(
  tx: Tx,
  organizationId: string,
  ingredients: ManufacturingOrderIngredientDetail[]
) {
  const plans = new Map<string, LotPickPlanEntry[]>();
  const lotTrackedItemIds = await getLotTrackedItemIdsInTx(
    tx,
    ingredients.map((ingredient) => ingredient.itemId)
  );

  for (const ingredient of ingredients) {
    if (!lotTrackedItemIds.has(ingredient.itemId)) {
      plans.set(ingredient.id, []);
      continue;
    }

    const existingAllocations = ingredient.lotAllocations ?? [];
    const lotPlan: LotPickPlanEntry[] = existingAllocations.map((allocation) => ({
      lotId: allocation.lotId,
      lotNumber: allocation.lotNumber,
      quantity: allocation.quantity,
      unitName: ingredient.unitName,
      sourceType: allocation.lotId ? ("inventory_lot" as const) : null,
      sourceId: allocation.sourceId,
      sourceLabel: allocation.sourceLabel,
      kind:
        allocation.sourceType === "picked" || allocation.sourceType === "consumed"
          ? ("picked" as const)
          : ("allocated" as const),
      status: "ready" as const,
    }));

    const allocatedQuantity = roundQuantity(
      existingAllocations.reduce(
        (sum, allocation) => sum + Number(allocation.quantity),
        0
      )
    );
    const remainingQuantity = getRemainingQuantityNumber(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    );
    const fifoQuantity = roundQuantity(remainingQuantity - allocatedQuantity);
    if (fifoQuantity > 0) {
      const unavailableByLotId = new Map<string, number>();
      for (const allocation of existingAllocations) {
        if (!allocation.lotId) continue;
        unavailableByLotId.set(
          allocation.lotId,
          roundQuantity(
            (unavailableByLotId.get(allocation.lotId) ?? 0) +
              Number(allocation.quantity)
          )
        );
      }
      lotPlan.push(
        ...(await buildFifoLotPickPlanInTx(tx, {
          organizationId,
          itemId: ingredient.itemId,
          quantity: fifoQuantity,
          unitName: ingredient.unitName,
          unavailableByLotId,
        }))
      );
    }

    plans.set(ingredient.id, lotPlan);
  }

  return plans;
}

export function getExecutionLotAllocationsByItemId(
  rows: Array<{ id: string; itemId: string }>,
  allocationsByIngredientId: Map<string, ExecutionIngredientLotAllocation[]>
) {
  const itemAllocations = new Map<string, ExecutionIngredientLotAllocation[]>();

  for (const row of rows) {
    const allocations = allocationsByIngredientId.get(row.id) ?? [];
    if (allocations.length === 0) continue;

    const existingAllocations = itemAllocations.get(row.itemId) ?? [];
    for (const allocation of allocations) {
      const existing = existingAllocations.find(
        (candidate) =>
          candidate.sourceType === allocation.sourceType &&
          candidate.sourceId === allocation.sourceId &&
          candidate.lotId === allocation.lotId
      );
      if (existing) {
        existing.quantity = normalizeNumeric(
          Number(existing.quantity) + Number(allocation.quantity)
        );
      } else {
        existingAllocations.push({ ...allocation });
      }
    }
    itemAllocations.set(row.itemId, existingAllocations);
  }

  return itemAllocations;
}

export function aggregateBatchIngredients(
  rows: ExecutionIngredientRow[]
): ManufacturingOrderIngredientDetail[] {
  const ingredientMap = new Map<string, ManufacturingOrderIngredientDetail>();

  for (const row of rows) {
    const ingredientKey = row.bomRevisionComponentId ?? row.itemId;
    const existing = ingredientMap.get(ingredientKey);
    if (!existing) {
      ingredientMap.set(ingredientKey, {
        id: row.id,
        bomRevisionComponentId: row.bomRevisionComponentId,
        itemId: row.itemId,
        itemName: row.itemName,
        itemSku: row.itemSku,
        itemType: row.itemType,
        lotTrackingMode: "tracked",
        unitName: row.unitName,
        quantityPerUnit: row.quantityPerUnit,
        plannedQuantity: row.plannedQuantity,
        lotStrategy: row.lotStrategy,
        pickedQuantity: row.pickedQuantity,
        remainingQuantity: getRemainingQuantityString(
          row.plannedQuantity,
          row.pickedQuantity
        ),
        pickStatus: row.pickStatus,
        actualQuantity: row.actualQuantity,
        actualCostTotal: row.actualCostTotal,
        sortOrder: row.sortOrder,
        constraints: row.constraints,
        defaultItemId: null,
        defaultItemName: null,
        defaultItemSku: null,
        defaultUnitName: null,
        defaultQuantityPerUnit: null,
        siblingVariants: [],
        alternates: [],
      });
      continue;
    }

    const plannedQuantity = sumNumericStrings([existing.plannedQuantity, row.plannedQuantity]);
    const pickedQuantity = sumNumericStrings([existing.pickedQuantity, row.pickedQuantity]);
    const actualQuantity = sumNumericStrings([existing.actualQuantity, row.actualQuantity]);
    const actualCostTotal = sumNumericStrings([existing.actualCostTotal, row.actualCostTotal]);

    existing.plannedQuantity = normalizeNumeric(plannedQuantity);
    existing.pickedQuantity = normalizeNumeric(pickedQuantity);
    existing.remainingQuantity = getRemainingQuantityString(
      existing.plannedQuantity,
      existing.pickedQuantity
    );
    existing.pickStatus = getPickProgressStatus([
      {
        plannedQuantity: existing.plannedQuantity,
        pickedQuantity: existing.pickedQuantity,
      },
    ]) === "picked"
      ? "picked"
      : pickedQuantity > 0
        ? "in_progress"
        : "not_picked";
    existing.actualQuantity = actualQuantity > 0 ? normalizeNumeric(actualQuantity) : null;
    existing.actualCostTotal =
      actualCostTotal > 0 ? normalizeNumeric(actualCostTotal) : null;
    existing.sortOrder = Math.min(existing.sortOrder, row.sortOrder);
  }

  return [...ingredientMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getBatchPickProgressStatus(
  batches: Array<Pick<ExecutionBatchRow, "status">>
): ManufacturingPickProgressStatus {
  if (batches.length === 0) {
    return "not_started";
  }

  const completedCount = batches.filter((batch) => batch.status === "completed").length;
  if (completedCount === batches.length) {
    return "picked";
  }

  if (completedCount > 0 || batches.some((batch) => batch.status === "in_progress")) {
    return "in_progress";
  }

  return "not_started";
}
