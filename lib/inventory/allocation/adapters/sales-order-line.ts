import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  items,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import { setSalesLineStockReservationInTx } from "@/lib/inventory/kernel";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  AllocationDemandAdapter,
  AllocationDemandAdapterRow,
} from "../types";

const ACTIVE_ORDER_STATUSES = ["open"] as const;

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
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

async function getPlannedByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
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
        eq(salesShipments.status, "planned")
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
    unitName: string;
    orderedQty: string;
    cancelledQty: string;
    sortOrder: number;
    createdAt: Date;
    variantAttrs: unknown;
    masterName: string | null;
    masterVariantAxes: unknown;
  },
  shippedQty: number,
  plannedQty: number
): AllocationDemandAdapterRow {
  const display = resolveVariantDisplay(
    row.itemName,
    row.masterName == null
      ? null
      : {
          name: row.masterName,
          variantAxes: row.masterVariantAxes as string[] | null,
        },
    row.variantAttrs as Record<string, string> | null
  );
  const orderedQty = toQuantity(row.orderedQty);
  const cancelledQty = toQuantity(row.cancelledQty);
  const openQty = roundQuantity(orderedQty - shippedQty - cancelledQty - plannedQty);

  return {
    demandType: "sales_order_line",
    demandId: row.salesOrderLineId,
    parentDemandId: row.salesOrderId,
    itemId: row.itemId,
    itemName: display.masterName,
    unitName: row.unitName,
    label: row.orderNumber,
    contextLabel: row.customerName,
    requiredDate: row.shipDate,
    openQty: quantityString(openQty),
    sortDate: row.shipDate,
    sortLabel: `${row.orderNumber}:${row.sortOrder}:${row.createdAt.toISOString()}`,
  };
}

async function loadSalesRowsInTx(
  tx: Tx,
  whereClause: ReturnType<typeof and>,
  options?: { subtractPlannedShipments?: boolean }
) {
  const masterItems = alias(items, "allocation_sales_master_items");
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      shipDate: salesOrders.shipDate,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      unitName: salesOrderLines.unitName,
      orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
      cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .leftJoin(items, eq(salesOrderLines.itemId, items.id))
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(whereClause)
    .orderBy(asc(salesOrders.shipDate), asc(salesOrders.orderNumber), asc(salesOrderLines.sortOrder));

  const shippedByLine = await getShippedByLineInTx(
    tx,
    rows.map((row) => row.salesOrderLineId)
  );
  const plannedByLine = options?.subtractPlannedShipments
    ? await getPlannedByLineInTx(
        tx,
        rows.map((row) => row.salesOrderLineId)
      )
    : new Map<string, number>();

  return rows
    .map((row) =>
      mapSalesDemandRow(
        row,
        shippedByLine.get(row.salesOrderLineId) ?? 0,
        plannedByLine.get(row.salesOrderLineId) ?? 0
      )
    )
    .filter((row) => toQuantity(row.openQty) > 0);
}

export async function getSalesLineInventoryLotAllocationQtyInTx(
  tx: Tx,
  params: { organizationId: string; salesOrderLineId: string; itemId: string }
) {
  const [direct] = await tx
    .select({ quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)` })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.demandId, params.salesOrderLineId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );

  const [shipment] = await tx
    .select({ quantity: sql<string>`COALESCE(SUM(${stockAllocations.quantity}), 0)` })
    .from(stockAllocations)
    .innerJoin(
      salesShipmentLines,
      eq(stockAllocations.demandId, salesShipmentLines.id)
    )
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(salesShipmentLines.salesOrderLineId, params.salesOrderLineId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    );

  return roundQuantity(toQuantity(direct?.quantity) + toQuantity(shipment?.quantity));
}

export async function syncSalesLineAllocationReservationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    salesOrderLineId: string;
    itemId: string;
    actorUserId?: string | null;
  }
) {
  const [order] = await tx
    .select({ status: salesOrders.status })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(eq(salesOrderLines.id, params.salesOrderLineId));

  if (order?.status !== "open") return;

  const quantity = await getSalesLineInventoryLotAllocationQtyInTx(tx, params);
  await setSalesLineStockReservationInTx(tx, {
    organizationId: params.organizationId,
    salesOrderLineId: params.salesOrderLineId,
    itemId: params.itemId,
    quantity,
    actorUserId: params.actorUserId ?? null,
  });
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
      ),
      { subtractPlannedShipments: true }
    );
  },
  async validateDemandItemInTx(tx, params) {
    const demand = await this.loadPrimaryDemandInTx(tx, params);
    return demand?.itemId === params.itemId ? demand : null;
  },
  async afterSaveAllocationsInTx(tx, params) {
    const [order] = await tx
      .select({ status: salesOrders.status })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(eq(salesOrderLines.id, params.demandId));

    await tx
      .update(salesOrderLines)
      .set({
        allocationManagedAt: new Date(),
        allocationManagedBy: params.actorUserId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(salesOrderLines.id, params.demandId));

    if (order?.status === "open") {
      await syncSalesLineAllocationReservationInTx(tx, {
        organizationId: params.organizationId,
        salesOrderLineId: params.demandId,
        itemId: params.itemId,
        actorUserId: params.actorUserId ?? null,
      });
    }
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
