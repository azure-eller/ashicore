import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  lots,
  manufacturingOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { serializeDbTimestamp } from "@/lib/db/timestamps";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
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

export async function loadAllocationSourcesForItemInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
  }
): Promise<AllocationSourceRow[]> {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const lotTracked = (await getItemLotTrackingModeInTx(tx, params.itemId)) === "tracked";
  const lotRows = lotTracked
    ? await tx
        .select({
          id: lots.id,
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
            eq(inventoryLotBalances.locationId, location.id),
            eq(inventoryLotBalances.itemId, params.itemId),
            eq(inventoryLotBalances.disposition, "available"),
            sql`(${lots.expiresOn} IS NULL OR ${lots.expiresOn} >= CURRENT_DATE)`,
            or(
              sql`${inventoryLotBalances.quantity} <> 0`,
              eq(lots.lotNumber, UNBATCHED_LOT_NUMBER)
            )
          )
        )
        .orderBy(
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
    eq(manufacturingOrders.productId, params.itemId),
    isNull(manufacturingOrders.deletedAt),
    eq(manufacturingOrders.status, "open"),
  ];
  const moRows = await tx
    .select({
      id: manufacturingOrders.id,
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
    .orderBy(asc(manufacturingOrders.plannedDate), asc(manufacturingOrders.orderNumber));

  const sources: AllocationSourceRow[] = lotRows.map((lot) => {
    const totalQty = toQuantity(lot.quantity);
    return {
      sourceType: "inventory_lot",
      sourceId: lot.id,
      itemId: params.itemId,
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
      itemId: params.itemId,
      label: mo.orderNumber,
      date: mo.plannedDate,
      linkedSalesOrderLineId: mo.salesOrderLineId,
      totalQty: quantityString(totalQty),
    });
  }

  return sources;
}
