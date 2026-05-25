import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "../format";
import type {
  AllocationDemandAdapter,
  AllocationDemandAdapterRow,
} from "../types";

const ACTIVE_ORDER_STATUSES = ["open"] as const;

function toQuantity(value: string | number | null | undefined) {
  return toAllocationQuantity(value);
}

function quantityString(value: number) {
  return allocationQuantityString(value);
}

async function getShippedByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: trimScale(sql`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .where(
      and(
        inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds),
        eq(salesShipments.status, "shipped")
      )
    )
    .groupBy(salesShipmentLines.salesOrderLineId);

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

function mapSalesDemandRow(
  row: {
    salesOrderLineId: string;
    salesOrderId: string;
    orderNumber: string;
    customerName: string;
    shipDate: string | null;
    itemId: string;
    itemName: string;
    familyName: string | null;
    optionLabels: string[];
    unitName: string;
    orderedQty: string;
    cancelledQty: string;
    sortOrder: number;
    createdAt: Date;
    priorityRank: number | null;
  },
  shippedQty: number,
  plannedQty: number
): AllocationDemandAdapterRow {
  const displayName =
    row.familyName && row.optionLabels.length > 0
      ? `${row.familyName} / ${row.optionLabels.join(" / ")}`
      : row.familyName ?? row.itemName;
  const orderedQty = toQuantity(row.orderedQty);
  const cancelledQty = toQuantity(row.cancelledQty);
  const openQty = roundQuantity(orderedQty - shippedQty - cancelledQty - plannedQty);

  return {
    demandType: "sales_order_line",
    demandId: row.salesOrderLineId,
    parentDemandId: row.salesOrderId,
    salesOrderId: row.salesOrderId,
    itemId: row.itemId,
    itemName: displayName,
    unitName: row.unitName,
    label: row.orderNumber,
    contextLabel: row.customerName,
    requiredDate: row.shipDate,
    openQty: quantityString(openQty),
    sortDate: row.shipDate,
    sortLabel: `${row.orderNumber}:${row.sortOrder}:${row.createdAt.toISOString()}`,
    priorityRank: row.priorityRank,
    priorityDate: row.shipDate,
    priorityLabel: row.orderNumber,
  };
}

async function getSalesAllocationOptionLabelsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, string[]>();
  for (const row of rows) {
    const labels = byItemId.get(row.itemId) ?? [];
    labels.push(row.label);
    byItemId.set(row.itemId, labels);
  }
  return byItemId;
}

async function loadSalesRowsInTx(
  tx: Tx,
  whereClause: ReturnType<typeof and>
) {
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      shipDate: salesOrders.shipDate,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      familyName: itemFamilies.name,
      unitName: salesOrderLines.unitName,
      orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
      cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      priorityRank: salesOrders.priorityRank,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .leftJoin(items, eq(salesOrderLines.itemId, items.id))
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(whereClause)
    .orderBy(asc(salesOrders.shipDate), asc(salesOrders.orderNumber), asc(salesOrderLines.sortOrder));

  const shippedByLine = await getShippedByLineInTx(
    tx,
    rows.map((row) => row.salesOrderLineId)
  );
  const optionLabelsByItemId = await getSalesAllocationOptionLabelsByItemIdInTx(
    tx,
    rows.map((row) => row.itemId)
  );

  return rows
    .map((row) =>
      mapSalesDemandRow(
        {
          ...row,
          optionLabels: optionLabelsByItemId.get(row.itemId) ?? [],
        },
        shippedByLine.get(row.salesOrderLineId) ?? 0,
        0
      )
    )
    .filter((row) => toQuantity(row.openQty) > 0);
}

export const salesOrderLineAllocationAdapter: AllocationDemandAdapter = {
  demandType: "sales_order_line",
  async loadPrimaryDemandInTx(tx, params) {
    const rows = await loadSalesRowsInTx(
      tx,
      and(
        eq(salesOrderLines.id, params.demandId),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, [...ACTIVE_ORDER_STATUSES])
      )
    );
    return rows[0] ?? null;
  },
  async loadOpenDemandsForItemInTx(tx, params) {
    return loadSalesRowsInTx(
      tx,
      and(
        eq(salesOrderLines.itemId, params.itemId),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, [...ACTIVE_ORDER_STATUSES])
      )
    );
  },
  async validateDemandItemInTx(tx, params) {
    const demand = await this.loadPrimaryDemandInTx(tx, params);
    return demand?.itemId === params.itemId ? demand : null;
  },
  async afterSaveAllocationsInTx(tx, params) {
    await tx
      .update(salesOrderLines)
      .set({
        allocationManagedAt: new Date(),
        allocationManagedBy: params.actorUserId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(salesOrderLines.id, params.demandId));
  },
};

export async function getSalesInventoryLotAllocationQtyInTx(
  tx: Tx,
  params: { demandId: string; itemId: string }
) {
  const [row] = await tx
    .select({ quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)` })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.demandId, params.demandId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );
  return roundQuantity(toQuantity(row?.quantity));
}
