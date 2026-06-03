import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  manufacturingOrderIngredientConstraints,
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { roundQuantity } from "@/lib/format";
import {
  getMinimumLotAgeDays,
  type BomComponentConstraint,
} from "@/lib/bom/constraints";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import type { Tx } from "@/lib/db/with-org-context";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "../format";
import type {
  AllocationDemandAdapter,
  AllocationDemandAdapterRow,
} from "../types";

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

function mapManufacturingIngredientDemandRow(row: {
  ingredientId: string;
  manufacturingOrderId: string;
  orderNumber: string;
  productName: string;
  plannedDate: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  plannedQuantity: string;
  pickedQuantity: string;
  sortOrder: number;
  createdAt: Date;
  priorityRank: number | null;
  minimumLotAgeDays: number | null;
}): AllocationDemandAdapterRow {
  const plannedQty = toQuantity(row.plannedQuantity);
  const pickedQty = toQuantity(row.pickedQuantity);
  const openQty = roundQuantity(plannedQty - pickedQty);

  return {
    demandType: "manufacturing_order_ingredient",
    demandId: row.ingredientId,
    parentDemandId: row.manufacturingOrderId,
    salesOrderId: null,
    itemId: row.itemId,
    itemName: row.itemName,
    unitName: row.unitName,
    label: row.orderNumber,
    contextLabel: row.productName,
    requiredDate: row.plannedDate,
    openQty: quantityString(openQty),
    pickedQty: quantityString(pickedQty),
    href: `/manufacturing/order/${row.manufacturingOrderId}`,
    sortDate: row.plannedDate,
    sortLabel: `${row.orderNumber}:${row.sortOrder}:${row.createdAt.toISOString()}`,
    priorityRank: row.priorityRank,
    priorityDate: row.plannedDate,
    priorityLabel: row.orderNumber,
    lateSupplyBehavior: "expected",
    minimumLotAgeDays: row.minimumLotAgeDays,
  };
}

async function loadManufacturingIngredientRowsInTx(
  tx: Tx,
  whereClause: ReturnType<typeof and>
) {
  const rows = await tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      plannedDate: manufacturingOrders.plannedDate,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      unitName: manufacturingOrderIngredients.unitName,
      plannedQuantity: trimScale(
        manufacturingOrderIngredients.plannedQuantity
      ).as("plannedQuantity"),
      pickedQuantity: trimScale(
        manufacturingOrderIngredients.pickedQuantity
      ).as("pickedQuantity"),
      sortOrder: manufacturingOrderIngredients.sortOrder,
      createdAt: manufacturingOrderIngredients.createdAt,
      priorityRank: manufacturingOrders.priorityRank,
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(whereClause)
    .orderBy(
      asc(manufacturingOrderIngredients.itemId),
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder)
    );

  const displayNamesByItemId = await getItemDisplayNamesByIdInTx(
    tx,
    rows.map((row) => row.itemId)
  );
  const constraintsByIngredientId = await getIngredientConstraintsByIngredientIdInTx(
    tx,
    rows.map((row) => row.ingredientId)
  );

  return rows
    .map((row) => {
      const constraints = constraintsByIngredientId.get(row.ingredientId) ?? [];
      return mapManufacturingIngredientDemandRow({
        ...row,
        itemName: displayNamesByItemId.get(row.itemId) ?? row.itemName,
        minimumLotAgeDays: getMinimumLotAgeDays(constraints),
      });
    })
    .filter((row) => toQuantity(row.openQty) > 0);
}

async function getIngredientConstraintsByIngredientIdInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  const result = new Map<string, BomComponentConstraint[]>();
  if (uniqueIds.length === 0) return result;

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

export const manufacturingOrderIngredientAllocationAdapter: AllocationDemandAdapter = {
  demandType: "manufacturing_order_ingredient",
  async loadOpenDemandsForItemsInTx(tx, params) {
    const itemIds = [...new Set(params.itemIds)].filter(Boolean);
    if (itemIds.length === 0) return [];

    return loadManufacturingIngredientRowsInTx(
      tx,
      and(
        inArray(manufacturingOrderIngredients.itemId, itemIds),
        eq(manufacturingOrders.organizationId, params.organizationId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        sql`${manufacturingOrderIngredients.plannedQuantity} > COALESCE(${manufacturingOrderIngredients.pickedQuantity}, 0)`
      )
    );
  },
};
