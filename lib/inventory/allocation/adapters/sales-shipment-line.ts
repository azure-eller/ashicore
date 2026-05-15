import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  AllocationDemandAdapter,
  AllocationDemandAdapterRow,
} from "../types";
import { syncSalesLineAllocationReservationInTx } from "./sales-order-line";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function mapShipmentDemandRow(row: {
  salesShipmentLineId: string;
  salesOrderLineId: string;
  salesOrderId: string;
  orderNumber: string;
  shipmentNumber: string;
  customerName: string;
  scheduledDate: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  quantity: string;
  sequence: number;
  sortOrder: number;
  createdAt: Date;
}): AllocationDemandAdapterRow {
  return {
    demandType: "sales_shipment_line",
    demandId: row.salesShipmentLineId,
    parentDemandId: row.salesOrderLineId,
    itemId: row.itemId,
    itemName: row.itemName,
    unitName: row.unitName,
    label: row.shipmentNumber,
    contextLabel: `${row.customerName} · ${row.orderNumber}`,
    requiredDate: row.scheduledDate,
    openQty: quantityString(toQuantity(row.quantity)),
    sortDate: row.scheduledDate,
    sortLabel: `${row.orderNumber}:${row.sequence}:${row.sortOrder}:${row.createdAt.toISOString()}`,
  };
}

async function loadShipmentRowsInTx(
  tx: Tx,
  whereClause: ReturnType<typeof and>
) {
  const rows = await tx
    .select({
      salesShipmentLineId: salesShipmentLines.id,
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      salesOrderId: salesShipments.salesOrderId,
      orderNumber: salesShipments.orderNumber,
      shipmentNumber: salesShipments.shipmentNumber,
      customerName: salesShipments.customerName,
      scheduledDate: salesShipments.scheduledDate,
      itemId: salesShipmentLines.itemId,
      itemName: salesShipmentLines.itemName,
      unitName: salesShipmentLines.unitName,
      quantity: trimScale(salesShipmentLines.quantity).as("quantity"),
      sequence: salesShipments.sequence,
      sortOrder: salesShipmentLines.sortOrder,
      createdAt: salesShipmentLines.createdAt,
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
    .where(whereClause)
    .orderBy(
      asc(salesShipments.scheduledDate),
      asc(salesShipments.orderNumber),
      asc(salesShipments.sequence),
      asc(salesShipmentLines.sortOrder)
    );

  return rows
    .map(mapShipmentDemandRow)
    .filter((row) => toQuantity(row.openQty) > 0);
}

export const salesShipmentLineAllocationAdapter: AllocationDemandAdapter = {
  demandType: "sales_shipment_line",
  async loadPrimaryDemandInTx(tx, params) {
    const rows = await loadShipmentRowsInTx(
      tx,
      and(
        eq(salesShipmentLines.id, params.demandId),
        eq(salesShipments.status, "planned"),
        eq(salesOrders.status, "open"),
        isNull(salesOrders.deletedAt)
      )
    );
    return rows[0] ?? null;
  },
  async loadOpenDemandsForItemInTx(tx, params) {
    return loadShipmentRowsInTx(
      tx,
      and(
        eq(salesShipmentLines.itemId, params.itemId),
        eq(salesShipments.status, "planned"),
        eq(salesOrders.status, "open"),
        isNull(salesOrders.deletedAt)
      )
    );
  },
  async validateDemandItemInTx(tx, params) {
    const demand = await this.loadPrimaryDemandInTx(tx, params);
    return demand?.itemId === params.itemId ? demand : null;
  },
  async afterSaveAllocationsInTx(tx, params) {
    const [line] = await tx
      .select({
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.id, params.demandId));

    if (!line) return;

    await syncSalesLineAllocationReservationInTx(tx, {
      organizationId: params.organizationId,
      salesOrderLineId: line.salesOrderLineId,
      itemId: params.itemId,
      actorUserId: params.actorUserId ?? null,
    });
  },
};
