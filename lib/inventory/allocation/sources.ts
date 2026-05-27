import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type { AllocationDemandRef, AllocationSourceRow } from "./types";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function sameDemand(
  row: { demandType: string; demandId: string },
  primaryDemand: AllocationDemandRef | null | undefined
) {
  return (
    primaryDemand != null &&
    row.demandType === primaryDemand.demandType &&
    row.demandId === primaryDemand.demandId
  );
}

function sameAnyDemand(
  row: { demandType: string; demandId: string },
  primaryDemands: AllocationDemandRef[]
) {
  return primaryDemands.some((primaryDemand) => sameDemand(row, primaryDemand));
}

async function getActiveSourceAllocationsForItemInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
) {
  return tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.status, "active"),
        sql`(
          (
            ${stockAllocations.demandType} = 'sales_order_line'
            AND EXISTS (
              SELECT 1
              FROM ${salesOrderLines}
              INNER JOIN ${salesOrders}
                ON ${salesOrders.id} = ${salesOrderLines.salesOrderId}
              WHERE ${salesOrderLines.id} = ${stockAllocations.demandId}
                AND ${salesOrders.status} = 'open'
                AND ${salesOrders.deletedAt} IS NULL
            )
          )
          OR (
            ${stockAllocations.demandType} = 'manufacturing_order_ingredient'
            AND EXISTS (
              SELECT 1
              FROM ${manufacturingOrderIngredients}
              INNER JOIN ${manufacturingOrders}
                ON ${manufacturingOrders.id} = ${manufacturingOrderIngredients.manufacturingOrderId}
              WHERE ${manufacturingOrderIngredients.id} = ${stockAllocations.demandId}
                AND ${manufacturingOrders.status} = 'open'
                AND ${manufacturingOrders.deletedAt} IS NULL
            )
          )
        )`
      )
    );
}

export async function loadAllocationSourcesForItemInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    primaryDemand?: AllocationDemandRef | null;
    primaryDemands?: AllocationDemandRef[];
  }
): Promise<AllocationSourceRow[]> {
  const activeRows = await getActiveSourceAllocationsForItemInTx(tx, params);
  const primaryDemands = params.primaryDemands ?? (
    params.primaryDemand ? [params.primaryDemand] : []
  );
  const allocatedBySource = new Map<string, number>();
  const currentBySource = new Map<string, number>();

  for (const row of activeRows) {
    const key = `${row.sourceType}:${row.sourceId}`;
    const qty = toQuantity(row.quantity);
    allocatedBySource.set(key, roundQuantity((allocatedBySource.get(key) ?? 0) + qty));
    if (sameAnyDemand(row, primaryDemands)) {
      currentBySource.set(key, roundQuantity((currentBySource.get(key) ?? 0) + qty));
    }
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const lotTracked = (await getItemLotTrackingModeInTx(tx, params.itemId)) === "tracked";
  const lotRows = lotTracked
    ? await tx
        .select({
          id: lots.id,
          lotNumber: lots.lotNumber,
          quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
          receivedAt: inventoryLotBalances.receivedAt,
          createdAt: lots.createdAt,
        })
        .from(inventoryLotBalances)
        .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
        .where(
          and(
            eq(inventoryLotBalances.organizationId, params.organizationId),
            eq(inventoryLotBalances.locationId, location.id),
            eq(inventoryLotBalances.itemId, params.itemId),
            eq(inventoryLotBalances.disposition, "available"),
            sql`${inventoryLotBalances.quantity} > 0`
          )
        )
        .orderBy(
          asc(inventoryLotBalances.receivedAt),
          asc(lots.createdAt),
          asc(lots.lotNumber),
          asc(lots.id)
        )
    : [];

  const manufacturingAllocatedSourceIds = activeRows
    .filter((row) => row.sourceType === "manufacturing_order" && row.sourceId)
    .map((row) => row.sourceId);

  const manufacturingConditions = [
    eq(manufacturingOrders.productId, params.itemId),
    isNull(manufacturingOrders.deletedAt),
    or(
      eq(manufacturingOrders.status, "open"),
      manufacturingAllocatedSourceIds.length > 0
        ? inArray(manufacturingOrders.id, manufacturingAllocatedSourceIds)
        : sql`false`
    ),
  ];
  const moRows = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      status: manufacturingOrders.status,
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      remainingExpectedQty: trimScale(sql`GREATEST(
        ${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0),
        0
      )`).as("remainingExpectedQty"),
    })
    .from(manufacturingOrders)
    .where(and(...manufacturingConditions))
    .orderBy(asc(manufacturingOrders.plannedDate), asc(manufacturingOrders.orderNumber));

  const sources: AllocationSourceRow[] = lotRows.map((lot) => {
    const key = `inventory_lot:${lot.id}` as const;
    const totalQty = toQuantity(lot.quantity);
    const allocatedQty = allocatedBySource.get(key) ?? 0;
    const currentPrimaryQty = currentBySource.get(key) ?? 0;
    const freeQty = Math.max(
      0,
      roundQuantity(totalQty - Math.max(0, allocatedQty - currentPrimaryQty))
    );
    return {
      sourceType: "inventory_lot",
      sourceId: lot.id,
      sourceKey: key,
      itemId: params.itemId,
      label: lot.lotNumber,
      contextLabel: null,
      status: "available",
      date: lot.receivedAt.toISOString(),
      priorityRank: null,
      totalQty: quantityString(totalQty),
      allocatedQty: quantityString(allocatedQty),
      freeQty: quantityString(freeQty),
      currentPrimaryQty: quantityString(currentPrimaryQty),
      maxQtyForPrimaryDemand: quantityString(freeQty),
      canAllocate: true,
    };
  });

  for (const mo of moRows) {
    const key = `manufacturing_order:${mo.id}` as const;
    const totalQty = toQuantity(mo.remainingExpectedQty);
    const allocatedQty = allocatedBySource.get(key) ?? 0;
    const currentPrimaryQty = currentBySource.get(key) ?? 0;
    const freeQty = Math.max(
      0,
      roundQuantity(totalQty - Math.max(0, allocatedQty - currentPrimaryQty))
    );
    const canAllocate = mo.status === "open" && totalQty > 0;

    sources.push({
      sourceType: "manufacturing_order",
      sourceId: mo.id,
      sourceKey: key,
      itemId: params.itemId,
      label: mo.orderNumber,
      contextLabel: mo.productName,
      status: mo.status,
      date: mo.plannedDate,
      priorityRank: mo.priorityRank,
      linkedSalesOrderLineId: mo.salesOrderLineId,
      totalQty: quantityString(totalQty),
      allocatedQty: quantityString(allocatedQty),
      freeQty: quantityString(freeQty),
      currentPrimaryQty: quantityString(currentPrimaryQty),
      maxQtyForPrimaryDemand: quantityString(freeQty),
      canAllocate,
    });
  }

  return sources;
}
