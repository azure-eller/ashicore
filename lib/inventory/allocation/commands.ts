import { and, eq, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  manufacturingOrderIngredients,
  manufacturingOrders,
  stockAllocations,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getOrganizationAllocationModeInTx } from "@/lib/dal/organization-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { AllocationError } from "./errors";
import { getAllocationDemandAdapter } from "./adapters";
import { getAllocationWorkspaceInTx } from "./read-model";
import type {
  AllocationDemandType,
  AllocationSourceType,
  SaveAllocationsForDemandInput,
} from "./types";
import { sourceKey } from "./types";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function isDemandType(value: string): value is AllocationDemandType {
  return (
    value === "sales_order_line" ||
    value === "sales_shipment_line" ||
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
    returnWorkspace?: boolean;
  }
) {
  if (!isDemandType(input.demandType)) {
    throw new AllocationError("Unsupported allocation demand type.");
  }

  // Demand-queue mode persists no manual allocations. Guard the write path here
  // (not just the route) so no caller — stale tab, direct request, bulk helper —
  // can recreate active allocations while the org is in demand_queue mode.
  const allocationMode = await getOrganizationAllocationModeInTx(tx, input.organizationId);
  if (allocationMode === "demand_queue") {
    throw new AllocationError(
      "Manual allocation is disabled in demand queue mode.",
      409
    );
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

  if (input.returnWorkspace === false) {
    return null;
  }

  return getAllocationWorkspaceInTx(tx, {
    organizationId: input.organizationId,
    primaryDemand: {
      demandType: input.demandType,
      demandId: input.demandId,
    },
    itemId: input.itemId,
  });
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
