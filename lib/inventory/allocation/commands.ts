import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  manufacturingOrderIngredients,
  manufacturingOrders,
  stockAllocations,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { roundQuantity } from "@/lib/format";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import { assertTrackedItemInTx, LotTrackingError } from "@/lib/inventory/lot-tracking";
import { AllocationError } from "./errors";
import { getAllocationDemandAdapter } from "./adapters";
import { getAllocationWorkspaceInTx } from "./read-model";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "./format";
import { reconcileAllocationPinsToReservationsInTx } from "./reservations";
import type {
  AllocationDemandType,
  AllocationDemandRef,
  AllocationSourceType,
  AllocationWorkspace,
  SaveAllocationsForDemandInput,
} from "./types";
import { sourceKey } from "./types";

const ALLOCATION_SAVE_RESULT = { ok: true } as const;

type AllocationOperationResult =
  | AllocationWorkspace
  | typeof ALLOCATION_SAVE_RESULT
  | null;

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

function isDemandType(value: string): value is AllocationDemandType {
  return (
    value === "sales_order_line" ||
    value === "manufacturing_order_ingredient"
  );
}

function isSourceType(value: string): value is AllocationSourceType {
  return value === "inventory_lot" || value === "manufacturing_order";
}

async function validateSourceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    demandType: AllocationDemandType;
    demandId: string;
    itemId: string;
    sourceType: AllocationSourceType;
    sourceId: string;
  }
) {
  if (params.sourceType === "inventory_lot") {
    try {
      await assertTrackedItemInTx(
        tx,
        params.itemId,
        "Manual lot allocations are not available for untracked items."
      );
    } catch (error) {
      if (error instanceof LotTrackingError) {
        throw new AllocationError(error.message, error.status);
      }
      throw error;
    }
    const [row] = await tx
      .select({
        quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
          "quantity"
        ),
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.itemId, params.itemId),
          eq(inventoryLotBalances.lotId, params.sourceId),
          eq(inventoryLotBalances.disposition, "available"),
          sql`${inventoryLotBalances.quantity} > 0`
        )
      );
    if (toQuantity(row?.quantity) <= 0) {
      throw new AllocationError("Inventory lot source is not available.", 409);
    }
    return;
  }

  const [row] = await tx
    .select({
      productId: manufacturingOrders.productId,
      status: manufacturingOrders.status,
      deletedAt: manufacturingOrders.deletedAt,
      remainingExpectedQty: trimScale(sql`GREATEST(
        ${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0),
        0
      )`).as("remainingExpectedQty"),
    })
    .from(manufacturingOrders)
    .where(eq(manufacturingOrders.id, params.sourceId))
    .for("update");
  if (
    !row ||
    row.deletedAt != null ||
    row.productId !== params.itemId ||
    row.status !== "open" ||
    toQuantity(row.remainingExpectedQty) <= 0
  ) {
    throw new AllocationError("Manufacturing order source is not available.", 409);
  }

  if (params.demandType === "manufacturing_order_ingredient") {
    const [ingredient] = await tx
      .select({
        manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, params.demandId));
    if (ingredient?.manufacturingOrderId === params.sourceId) {
      throw new AllocationError(
        "A manufacturing order cannot allocate output to its own ingredient demand.",
        409
      );
    }
  }
}

export async function saveAllocationsForDemandInTx(
  tx: Tx,
  input: SaveAllocationsForDemandInput & {
    organizationId: string;
    idempotencyKey?: string | null;
    returnWorkspace?: boolean;
  }
) {
  if (!isDemandType(input.demandType)) {
    throw new AllocationError("Unsupported allocation demand type.");
  }

  const adapter = getAllocationDemandAdapter(input.demandType);
  const demand = await adapter.validateDemandItemInTx(tx, {
    organizationId: input.organizationId,
    demandId: input.demandId,
    itemId: input.itemId,
  });
  if (!demand) {
    throw new AllocationError("Allocation demand not found.", 404);
  }

  await tx
    .select({ id: stockAllocations.id })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, input.organizationId),
        eq(stockAllocations.itemId, input.itemId),
        eq(stockAllocations.status, "active")
      )
    )
    .for("update");

  const normalized = input.allocations
    .map((allocation) => {
      if (!isSourceType(allocation.sourceType)) {
        throw new AllocationError("Unsupported allocation source type.");
      }
      return {
        sourceType: allocation.sourceType,
        sourceId: allocation.sourceId,
        quantity: roundQuantity(toQuantity(allocation.quantity)),
      };
    })
    .filter((allocation) => allocation.quantity > 0);

  const seen = new Set<string>();
  for (const allocation of normalized) {
    const key = sourceKey(allocation);
    if (seen.has(key)) {
      throw new AllocationError("Each source can only be allocated once.");
    }
    seen.add(key);
    await validateSourceInTx(tx, {
      organizationId: input.organizationId,
      demandType: input.demandType,
      demandId: input.demandId,
      itemId: input.itemId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
    });
  }

  const totalAllocation = roundQuantity(
    normalized.reduce((sum, allocation) => sum + allocation.quantity, 0)
  );
  if (totalAllocation > toQuantity(demand.openQty)) {
    throw new AllocationError("Allocated quantity cannot exceed open demand.", 409);
  }

  const workspace = await getAllocationWorkspaceInTx(tx, {
    organizationId: input.organizationId,
    primaryDemand: {
      demandType: input.demandType,
      demandId: input.demandId,
    },
    itemId: input.itemId,
  });
  const sourcesByKey = new Map(workspace?.sources.map((source) => [source.sourceKey, source]));
  for (const allocation of normalized) {
    const source = sourcesByKey.get(sourceKey(allocation));
    if (!source) throw new AllocationError("Allocation source is no longer available.", 409);
    if (!source.canAllocate && allocation.quantity > toQuantity(source.currentPrimaryQty)) {
      throw new AllocationError("Allocation source is not allocatable.", 409);
    }
    if (allocation.quantity > toQuantity(source.maxQtyForPrimaryDemand)) {
      throw new AllocationError(
        `${source.label} only has ${source.maxQtyForPrimaryDemand} available.`,
        409
      );
    }
  }

  const replay = await beginInventoryOperationInTx<AllocationOperationResult>(tx, {
    organizationId: input.organizationId,
    operationName: "saveAllocationWorkspace",
    idempotencyKey: input.idempotencyKey ?? null,
    payload: {
      demandType: input.demandType,
      demandId: input.demandId,
      itemId: input.itemId,
      allocations: input.allocations,
    },
  });
  if (replay.replayed) return replay.result;

  const now = new Date();
  const submittedKeys = new Set<string>(
    normalized.map((allocation) => sourceKey(allocation))
  );
  const currentRows = await tx
    .select({
      id: stockAllocations.id,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, input.organizationId),
        eq(stockAllocations.demandType, input.demandType),
        eq(stockAllocations.demandId, input.demandId),
        eq(stockAllocations.itemId, input.itemId),
        eq(stockAllocations.status, "active")
      )
    )
    .for("update");

  for (const row of currentRows) {
    if (!row.sourceId) continue;
    const key = `${row.sourceType}:${row.sourceId}`;
    if (!submittedKeys.has(key)) {
      await tx
        .update(stockAllocations)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: input.actorUserId ?? null,
          updatedBy: input.actorUserId ?? null,
          updatedAt: now,
        })
        .where(eq(stockAllocations.id, row.id));
    }
  }

  for (const allocation of normalized) {
    const [existing] = currentRows.filter(
      (row) =>
        row.sourceType === allocation.sourceType && row.sourceId === allocation.sourceId
    );
    if (existing) {
      await tx
        .update(stockAllocations)
        .set({
          quantity: quantityString(allocation.quantity),
          updatedBy: input.actorUserId ?? null,
          updatedAt: now,
        })
        .where(eq(stockAllocations.id, existing.id));
      continue;
    }

    await tx.insert(stockAllocations).values({
      organizationId: input.organizationId,
      demandType: input.demandType,
      demandId: input.demandId,
      itemId: input.itemId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
      quantity: quantityString(allocation.quantity),
      status: "active",
      demandLabelSnapshot: demand.label,
      sourceLabelSnapshot: sourcesByKey.get(sourceKey(allocation))?.label ?? null,
      createdBy: input.actorUserId ?? null,
      updatedBy: input.actorUserId ?? null,
    });
  }

  const inventoryLotAllocationQty = normalized
    .filter((allocation) => allocation.sourceType === "inventory_lot")
    .reduce((sum, allocation) => roundQuantity(sum + allocation.quantity), 0);
  await adapter.afterSaveAllocationsInTx?.(tx, {
    organizationId: input.organizationId,
    demandId: input.demandId,
    itemId: input.itemId,
    actorUserId: input.actorUserId ?? null,
    inventoryLotAllocationQty,
  });

  await reconcileAllocationPinsToReservationsInTx(tx, {
    organizationId: input.organizationId,
    itemId: input.itemId,
    affectedDemands: [
      {
        demandType: input.demandType,
        demandId: input.demandId,
      },
    ],
    actorUserId: input.actorUserId ?? null,
    closedDemandPolicy: "release",
    releaseUnpinnedAffectedDemands: true,
  });

  if (input.returnWorkspace === false) {
    await finishInventoryOperationInTx(tx, {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey ?? null,
      // Idempotent replay needs a non-null envelope even though this caller
      // intentionally receives null on the first successful save.
      result: ALLOCATION_SAVE_RESULT,
    });
    return null;
  }

  const result = await getAllocationWorkspaceInTx(tx, {
    organizationId: input.organizationId,
    primaryDemand: {
      demandType: input.demandType,
      demandId: input.demandId,
    },
    itemId: input.itemId,
  });
  await finishInventoryOperationInTx(tx, {
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey ?? null,
    result: result ?? ALLOCATION_SAVE_RESULT,
  });
  return result;
}

export async function saveAllocationsForManufacturingIngredientGroupInTx(
  tx: Tx,
  input: Omit<SaveAllocationsForDemandInput, "demandType" | "demandId"> & {
    demandIds: string[];
    organizationId: string;
    idempotencyKey?: string | null;
  }
) {
  const demandIds = [...new Set(input.demandIds)].filter(Boolean);
  if (demandIds.length === 0) {
    throw new AllocationError("Allocation demand not found.", 404);
  }

  const demandRows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
      itemId: manufacturingOrderIngredients.itemId,
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      deletedAt: manufacturingOrders.deletedAt,
      completedAt: manufacturingOrders.completedAt,
      cancelledAt: manufacturingOrders.cancelledAt,
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.organizationId, input.organizationId),
        inArray(manufacturingOrderIngredients.id, demandIds)
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.sortOrder), asc(manufacturingOrderIngredients.id))
    .for("update");

  if (demandRows.length !== demandIds.length) {
    throw new AllocationError("Allocation demand not found.", 404);
  }

  const first = demandRows[0];
  if (
    demandRows.some(
      (row) =>
        row.manufacturingOrderId !== first.manufacturingOrderId ||
        row.itemId !== input.itemId ||
        row.itemId !== first.itemId ||
        row.status !== "open" ||
        row.deletedAt != null ||
        row.completedAt != null ||
        row.cancelledAt != null
    )
  ) {
    throw new AllocationError(
      "Manufacturing ingredient allocations must belong to one open order and item.",
      409
    );
  }

  await tx
    .select({ id: stockAllocations.id })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, input.organizationId),
        eq(stockAllocations.itemId, input.itemId),
        eq(stockAllocations.status, "active")
      )
    )
    .for("update");

  const normalized = input.allocations
    .map((allocation) => {
      if (!isSourceType(allocation.sourceType)) {
        throw new AllocationError("Unsupported allocation source type.");
      }
      return {
        sourceType: allocation.sourceType,
        sourceId: allocation.sourceId,
        quantity: roundQuantity(toQuantity(allocation.quantity)),
      };
    })
    .filter((allocation) => allocation.quantity > 0);

  const seen = new Set<string>();
  for (const allocation of normalized) {
    const key = sourceKey(allocation);
    if (seen.has(key)) {
      throw new AllocationError("Each source can only be allocated once.");
    }
    seen.add(key);
    await validateSourceInTx(tx, {
      organizationId: input.organizationId,
      demandType: "manufacturing_order_ingredient",
      demandId: first.id,
      itemId: input.itemId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
    });
  }

  const demands = demandRows.map((row) => ({
    id: row.id,
    remaining: roundQuantity(
      Math.max(0, toQuantity(row.plannedQuantity) - toQuantity(row.pickedQuantity))
    ),
  }));
  const totalOpenQty = roundQuantity(
    demands.reduce((sum, demand) => sum + demand.remaining, 0)
  );
  const totalAllocation = roundQuantity(
    normalized.reduce((sum, allocation) => sum + allocation.quantity, 0)
  );
  if (totalAllocation > totalOpenQty) {
    throw new AllocationError("Allocated quantity cannot exceed open demand.", 409);
  }

  const primaryDemands: AllocationDemandRef[] = demandRows.map((row) => ({
    demandType: "manufacturing_order_ingredient",
    demandId: row.id,
  }));
  const workspace = await getAllocationWorkspaceInTx(tx, {
    organizationId: input.organizationId,
    primaryDemands,
    itemId: input.itemId,
  });
  const sourcesByKey = new Map(workspace?.sources.map((source) => [source.sourceKey, source]));
  for (const allocation of normalized) {
    const source = sourcesByKey.get(sourceKey(allocation));
    if (!source) throw new AllocationError("Allocation source is no longer available.", 409);
    if (!source.canAllocate && allocation.quantity > toQuantity(source.currentPrimaryQty)) {
      throw new AllocationError("Allocation source is not allocatable.", 409);
    }
    if (allocation.quantity > toQuantity(source.maxQtyForPrimaryDemand)) {
      throw new AllocationError(
        `${source.label} only has ${source.maxQtyForPrimaryDemand} available.`,
        409
      );
    }
  }

  const replay = await beginInventoryOperationInTx<AllocationOperationResult>(tx, {
    organizationId: input.organizationId,
    operationName: "saveManufacturingIngredientGroupAllocationWorkspace",
    idempotencyKey: input.idempotencyKey ?? null,
    payload: {
      demandIds: input.demandIds,
      itemId: input.itemId,
      allocations: input.allocations,
    },
  });
  if (replay.replayed) return replay.result;

  const now = new Date();
  await tx
    .update(stockAllocations)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: input.actorUserId ?? null,
      updatedBy: input.actorUserId ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(stockAllocations.organizationId, input.organizationId),
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        inArray(stockAllocations.demandId, demandRows.map((row) => row.id)),
        eq(stockAllocations.itemId, input.itemId),
        eq(stockAllocations.status, "active")
      )
    );

  const inserts = [];
  let demandIndex = 0;
  for (const allocation of normalized) {
    let sourceRemaining = allocation.quantity;
    while (sourceRemaining > 0 && demandIndex < demands.length) {
      const demand = demands[demandIndex];
      if (demand.remaining <= 0) {
        demandIndex += 1;
        continue;
      }

      const quantity = roundQuantity(Math.min(sourceRemaining, demand.remaining));
      if (quantity <= 0) break;

      inserts.push({
        organizationId: input.organizationId,
        demandType: "manufacturing_order_ingredient" as const,
        demandId: demand.id,
        itemId: input.itemId,
        sourceType: allocation.sourceType,
        sourceId: allocation.sourceId,
        quantity: quantityString(quantity),
        status: "active" as const,
        demandLabelSnapshot: first.orderNumber,
        sourceLabelSnapshot: sourcesByKey.get(sourceKey(allocation))?.label ?? null,
        createdBy: input.actorUserId ?? null,
        updatedBy: input.actorUserId ?? null,
      });

      demand.remaining = roundQuantity(demand.remaining - quantity);
      sourceRemaining = roundQuantity(sourceRemaining - quantity);
      if (demand.remaining <= 0) demandIndex += 1;
    }
  }

  if (inserts.length > 0) {
    await tx.insert(stockAllocations).values(inserts);
  }

  await reconcileAllocationPinsToReservationsInTx(tx, {
    organizationId: input.organizationId,
    itemId: input.itemId,
    affectedDemands: primaryDemands,
    actorUserId: input.actorUserId ?? null,
    closedDemandPolicy: "release",
    releaseUnpinnedAffectedDemands: true,
  });

  const result = await getAllocationWorkspaceInTx(tx, {
    organizationId: input.organizationId,
    primaryDemands,
    itemId: input.itemId,
  });
  await finishInventoryOperationInTx(tx, {
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey ?? null,
    result: result ?? ALLOCATION_SAVE_RESULT,
  });
  return result;
}

export async function saveAllocationsForDemand(input: SaveAllocationsForDemandInput) {
  return withAuthedOrgContext((tx, organizationId, actorUserId) =>
    saveAllocationsForDemandInTx(tx, {
      ...input,
      organizationId,
      actorUserId,
    })
  );
}
