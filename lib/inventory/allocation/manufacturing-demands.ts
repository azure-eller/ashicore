import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  manufacturingOrderIngredients,
  manufacturingOrders,
  stockAllocations,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";

export type ManufacturingAllocationDemandRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  productName: string;
  plannedDate: string | null;
  href: string;
  ingredients: Array<{
    id: string;
    itemId: string;
    itemName: string;
    itemSku: string | null;
    unitName: string;
    plannedQty: string;
    pickedQty: string;
    openQty: string;
    allocatedQty: string;
    shortQty: string;
  }>;
};

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

export async function getManufacturingAllocationDemandRowsInTx(
  tx: Tx,
  organizationId: string
): Promise<ManufacturingAllocationDemandRow[]> {
  const ingredientRows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      plannedDate: manufacturingOrders.plannedDate,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      unitName: manufacturingOrderIngredients.unitName,
      plannedQty: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQty"
      ),
      pickedQty: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQty"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.organizationId, organizationId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        sql`${manufacturingOrderIngredients.plannedQuantity} > COALESCE(${manufacturingOrderIngredients.pickedQuantity}, 0)`
      )
    )
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder)
    );

  if (ingredientRows.length === 0) return [];

  const allocationRows = await tx
    .select({
      demandId: stockAllocations.demandId,
      quantity: trimScale(sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, organizationId),
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        inArray(
          stockAllocations.demandId,
          ingredientRows.map((row) => row.id)
        ),
        eq(stockAllocations.status, "active")
      )
    )
    .groupBy(stockAllocations.demandId);
  const allocatedByIngredientId = new Map(
    allocationRows.map((row) => [row.demandId, toQuantity(row.quantity)])
  );

  const byOrderId = new Map<string, ManufacturingAllocationDemandRow>();
  for (const row of ingredientRows) {
    const order =
      byOrderId.get(row.manufacturingOrderId) ??
      ({
        id: `manufacturing:${row.manufacturingOrderId}`,
        orderId: row.manufacturingOrderId,
        orderNumber: row.orderNumber,
        productName: row.productName,
        plannedDate: row.plannedDate,
        href: `/manufacturing/orders/${row.manufacturingOrderId}`,
        ingredients: [],
      } satisfies ManufacturingAllocationDemandRow);
    byOrderId.set(row.manufacturingOrderId, order);

    const openQty = roundQuantity(toQuantity(row.plannedQty) - toQuantity(row.pickedQty));
    const allocatedQty = allocatedByIngredientId.get(row.id) ?? 0;
    order.ingredients.push({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      unitName: row.unitName,
      plannedQty: row.plannedQty,
      pickedQty: row.pickedQty,
      openQty: quantityString(openQty),
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(openQty - allocatedQty),
    });
  }

  return [...byOrderId.values()];
}
