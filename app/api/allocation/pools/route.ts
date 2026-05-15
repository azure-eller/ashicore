import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import {
  inventoryReservationsSummary,
  salesOrderLines,
  salesOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);

  const { searchParams } = new URL(request.url);
  const itemIds = [...new Set(searchParams.getAll("itemId"))].filter(Boolean);

  if (itemIds.length === 0) {
    return NextResponse.json([]);
  }

  if (itemIds.length > 100) {
    return NextResponse.json(
      { error: "Too many allocation pool items requested." },
      { status: 400 }
    );
  }

  const data = await withAuthedOrgContext(async (tx, orgId) => {
    const reservationRows = await tx
      .select({
        itemId: inventoryReservationsSummary.itemId,
        demandId: inventoryReservationsSummary.referenceId,
        quantity: trimScale(inventoryReservationsSummary.quantity).as("quantity"),
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
      })
      .from(inventoryReservationsSummary)
      .innerJoin(
        salesOrderLines,
        eq(inventoryReservationsSummary.referenceId, salesOrderLines.id)
      )
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(inventoryReservationsSummary.organizationId, orgId),
          eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
          inArray(inventoryReservationsSummary.itemId, itemIds),
          eq(salesOrders.status, "open"),
          isNull(salesOrders.deletedAt)
        )
      );
    const reservationsByItemId = new Map<string, typeof reservationRows>();
    for (const row of reservationRows) {
      const current = reservationsByItemId.get(row.itemId) ?? [];
      current.push(row);
      reservationsByItemId.set(row.itemId, current);
    }
    const rows = [];

    for (const itemId of itemIds) {
      const workspace = await getAllocationWorkspaceInTx(tx, {
        organizationId: orgId,
        itemId,
      });

      if (!workspace) {
        rows.push({
          itemId,
          stockQty: "0",
          incomingQty: "0",
          stockAllocatedQty: "0",
          incomingAllocatedQty: "0",
          allocatedQty: "0",
          assignments: [],
          reservations: reservationsByItemId.get(itemId) ?? [],
        });
        continue;
      }

      const stockQty = workspace.sources
        .filter((source) => source.sourceType === "inventory_lot")
        .reduce((sum, source) => sum + toQuantity(source.freeQty), 0);
      const incomingQty = workspace.sources
        .filter((source) => source.sourceType === "manufacturing_order")
        .reduce((sum, source) => sum + toQuantity(source.freeQty), 0);
      const allocatedQty = workspace.assignments.reduce(
        (sum, assignment) => sum + toQuantity(assignment.quantity),
        0
      );
      const stockAllocatedQty = workspace.assignments
        .filter((assignment) => assignment.sourceType === "inventory_lot")
        .reduce((sum, assignment) => sum + toQuantity(assignment.quantity), 0);
      const incomingAllocatedQty = workspace.assignments
        .filter((assignment) => assignment.sourceType === "manufacturing_order")
        .reduce((sum, assignment) => sum + toQuantity(assignment.quantity), 0);

      rows.push({
        itemId,
        stockQty: quantityString(stockQty),
        incomingQty: quantityString(incomingQty),
        stockAllocatedQty: quantityString(stockAllocatedQty),
        incomingAllocatedQty: quantityString(incomingAllocatedQty),
        allocatedQty: quantityString(allocatedQty),
        assignments: workspace.assignments.map((assignment) => ({
          demandType: assignment.demandType,
          demandId: assignment.demandId,
          sourceType: assignment.sourceType,
          sourceId: assignment.sourceId,
          sourceLabel: assignment.sourceLabel,
          demandLabel: assignment.demandLabel,
          quantity: assignment.quantity,
        })),
        reservations: (reservationsByItemId.get(itemId) ?? []).map((reservation) => ({
          demandId: reservation.demandId,
          demandLabel: `${reservation.orderNumber} ${reservation.customerName}`,
          quantity: reservation.quantity,
        })),
      });
    }

    return rows;
  });

  return NextResponse.json(data);
});
