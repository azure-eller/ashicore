import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  lots,
  manufacturingOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { serializeDbTimestamp } from "@/lib/db/timestamps";
import type { Tx } from "@/lib/db/with-org-context";
import type { LotTrackingMode } from "@/lib/inventory/lot-tracking";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "./format";
import type { AllocationSourceRow } from "./types";

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;
const UNBATCHED_LOT_NUMBER = "UNBATCHED";
const signedQuantityString = (value: number) => normalizeNumeric(roundQuantity(value));

export async function loadAllocationSourcesForItemsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemIds: string[];
    locationId: string;
    lotTrackingModesByItemId: Map<string, LotTrackingMode>;
  }
): Promise<AllocationSourceRow[]> {
  const itemIds = [...new Set(params.itemIds)].filter(Boolean);
  if (itemIds.length === 0) return [];

  const trackedItemIds = itemIds.filter(
    (itemId) => (params.lotTrackingModesByItemId.get(itemId) ?? "tracked") === "tracked"
  );
  const lotRows = trackedItemIds.length > 0
    ? await tx
        .select({
          id: lots.id,
          itemId: inventoryLotBalances.itemId,
          lotNumber: lots.lotNumber,
          quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
          receivedAt: inventoryLotBalances.receivedAt,
          expiresOn: lots.expiresOn,
          createdAt: lots.createdAt,
        })
        .from(inventoryLotBalances)
        .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
        .where(
          and(
            eq(inventoryLotBalances.organizationId, params.organizationId),
            eq(inventoryLotBalances.locationId, params.locationId),
            inArray(inventoryLotBalances.itemId, trackedItemIds),
            eq(inventoryLotBalances.disposition, "available"),
            sql`(${lots.expiresOn} IS NULL OR ${lots.expiresOn} >= CURRENT_DATE)`,
            or(
              sql`${inventoryLotBalances.quantity} <> 0`,
              eq(lots.lotNumber, UNBATCHED_LOT_NUMBER)
            )
          )
        )
        .orderBy(
          asc(inventoryLotBalances.itemId),
          sql`CASE
            WHEN ${lots.lotNumber} = ${UNBATCHED_LOT_NUMBER} THEN 0
            WHEN ${lots.expiresOn} IS NULL THEN 2
            ELSE 1
          END`,
          asc(lots.expiresOn),
          asc(inventoryLotBalances.receivedAt),
          asc(lots.createdAt),
          asc(lots.lotNumber),
          asc(lots.id)
        )
    : [];

  const manufacturingConditions = [
    inArray(manufacturingOrders.productId, itemIds),
    isNull(manufacturingOrders.deletedAt),
    eq(manufacturingOrders.status, "open"),
  ];
  const moRows = await tx
    .select({
      id: manufacturingOrders.id,
      itemId: manufacturingOrders.productId,
      orderNumber: manufacturingOrders.orderNumber,
      plannedDate: manufacturingOrders.plannedDate,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      remainingExpectedQty: trimScale(sql`GREATEST(
        ${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0),
        0
      )`).as("remainingExpectedQty"),
    })
    .from(manufacturingOrders)
    .where(and(...manufacturingConditions))
    .orderBy(
      asc(manufacturingOrders.productId),
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber)
    );

  const sources: AllocationSourceRow[] = lotRows.map((lot) => {
    const totalQty = toQuantity(lot.quantity);
    return {
      sourceType: "inventory_lot",
      sourceId: lot.id,
      itemId: lot.itemId,
      label: lot.lotNumber,
      date: serializeDbTimestamp(lot.receivedAt),
      totalQty: signedQuantityString(totalQty),
    };
  });

  for (const mo of moRows) {
    const totalQty = toQuantity(mo.remainingExpectedQty);

    sources.push({
      sourceType: "manufacturing_order",
      sourceId: mo.id,
      itemId: mo.itemId,
      label: mo.orderNumber,
      date: mo.plannedDate,
      linkedSalesOrderLineId: mo.salesOrderLineId,
      totalQty: quantityString(totalQty),
    });
  }

  return sources;
}
