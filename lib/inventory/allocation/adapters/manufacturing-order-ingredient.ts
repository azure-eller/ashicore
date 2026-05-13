import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  AllocationDemandAdapter,
  AllocationDemandAdapterRow,
} from "../types";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

async function loadManufacturingRowsInTx(
  tx: Tx,
  whereClause: ReturnType<typeof and>
) {
  const rows = await tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      manufacturingOrderId: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      plannedDate: manufacturingOrders.plannedDate,
      status: manufacturingOrders.status,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      unitName: manufacturingOrderIngredients.unitName,
      plannedQty: trimScale(manufacturingOrderIngredients.plannedQuantity).as("plannedQty"),
      pickedQty: trimScale(manufacturingOrderIngredients.pickedQuantity).as("pickedQty"),
      actualQty: trimScale(
        sql`COALESCE(${manufacturingOrderIngredients.actualQuantity}, 0)`
      ).as("actualQty"),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(whereClause)
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder)
    );

  return rows
    .map((row): AllocationDemandAdapterRow => {
      const consumedQty = Math.max(toQuantity(row.pickedQty), toQuantity(row.actualQty));
      const openQty = roundQuantity(toQuantity(row.plannedQty) - consumedQty);
      return {
        demandType: "manufacturing_order_ingredient",
        demandId: row.ingredientId,
        parentDemandId: row.manufacturingOrderId,
        itemId: row.itemId,
        itemName: row.itemName,
        unitName: row.unitName,
        label: row.orderNumber,
        contextLabel: `${row.productName} ingredient`,
        requiredDate: row.plannedDate,
        openQty: quantityString(openQty),
        sortDate: row.plannedDate,
        sortLabel: `${row.orderNumber}:${row.sortOrder}`,
        parentManufacturingOrderId: row.manufacturingOrderId,
      };
    })
    .filter((row) => toQuantity(row.openQty) > 0);
}

export const manufacturingOrderIngredientAllocationAdapter: AllocationDemandAdapter = {
  demandType: "manufacturing_order_ingredient",
  async loadPrimaryDemandInTx(tx, params) {
    const rows = await loadManufacturingRowsInTx(
      tx,
      and(
        eq(manufacturingOrderIngredients.id, params.demandId),
        isNull(manufacturingOrders.deletedAt),
        inArray(manufacturingOrders.status, ["draft", "released"])
      )
    );
    return rows[0] ?? null;
  },
  async loadOpenDemandsForItemInTx(tx, params) {
    return loadManufacturingRowsInTx(
      tx,
      and(
        eq(manufacturingOrderIngredients.itemId, params.itemId),
        isNull(manufacturingOrders.deletedAt),
        inArray(manufacturingOrders.status, ["draft", "released"])
      )
    );
  },
  async validateDemandItemInTx(tx, params) {
    const demand = await this.loadPrimaryDemandInTx(tx, params);
    return demand?.itemId === params.itemId ? demand : null;
  },
};
