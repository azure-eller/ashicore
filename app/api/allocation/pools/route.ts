import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { getAuthedApiMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { requestSearchParams } from "@/lib/routing/search-params";
import {
  inventoryLotBalances,
  inventoryReservationsSummary,
  salesOrderLines,
  salesOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "@/lib/inventory/allocation/format";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel";

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

export const GET = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const canReadSales = hasModuleAccess(context.assignedRoles, "sales", "read");
  const canReadManufacturing = hasModuleAccess(
    context.assignedRoles,
    "manufacturing",
    "read"
  );
  if (!canReadSales && !canReadManufacturing) {
    return jsonError("You do not have access to allocation.", 403);
  }

  const searchParams = requestSearchParams(request);
  const itemIds = [...new Set(searchParams.getAll("itemId"))].filter(Boolean);

  if (itemIds.length === 0) {
    return NextResponse.json([]);
  }

  if (itemIds.length > 100) {
    return jsonError("Too many allocation pool items requested.");
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
        includeManufacturingDemand: canReadManufacturing,
      });

      if (!workspace) {
        rows.push({
          itemId,
          stockQty: "0",
          incomingQty: "0",
          allocatedQty: "0",
          totalDemandQty: "0",
          assignments: [],
          reservations: reservationsByItemId.get(itemId) ?? [],
        });
        continue;
      }

      let stockQty = workspace.sources
        .filter((source) => source.sourceType === "inventory_lot")
        .reduce((sum, source) => sum + toQuantity(source.totalQty), 0);
      if (stockQty === 0 && (await getItemLotTrackingModeInTx(tx, itemId)) === "untracked") {
        const location = await getDefaultInventoryLocationInTx(tx, orgId);
        const [available] = await tx
          .select({
            quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
              "quantity"
            ),
          })
          .from(inventoryLotBalances)
          .where(
            and(
              eq(inventoryLotBalances.organizationId, orgId),
              eq(inventoryLotBalances.locationId, location.id),
              eq(inventoryLotBalances.itemId, itemId),
              eq(inventoryLotBalances.disposition, "available")
            )
          );
        stockQty = toQuantity(available?.quantity);
      }
      const incomingQty = workspace.sources
        .filter((source) => source.sourceType === "manufacturing_order")
        .reduce((sum, source) => sum + toQuantity(source.totalQty), 0);
      const allocatedQty = workspace.assignments.reduce(
        (sum, assignment) => sum + toQuantity(assignment.quantity),
        0
      );
      const totalDemandQty = workspace.demands.reduce(
        (sum, demand) => sum + toQuantity(demand.openQty),
        0
      );

      rows.push({
        itemId,
        stockQty: quantityString(stockQty),
        incomingQty: quantityString(incomingQty),
        allocatedQty: quantityString(allocatedQty),
        totalDemandQty: quantityString(totalDemandQty),
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
