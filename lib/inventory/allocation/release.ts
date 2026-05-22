import "server-only";

import { and, eq } from "drizzle-orm";
import { salesShipmentLines, stockAllocations } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { cancelActiveStockAllocationsInTx } from "@/lib/inventory/kernel";
import { syncSalesLineAllocationReservationInTx } from "./adapters/sales-order-line";

// Releases every active manual allocation for the org (across all demand/source
// types) and releases the sales-line stock reservations those allocations
// produced. Used when switching the org into demand-queue mode so no active
// manual allocation can silently influence execution paths.
export async function releaseAllActiveAllocationsForOrgInTx(
  tx: Tx,
  params: { organizationId: string; actorUserId?: string | null }
) {
  // Identify sales-order lines whose reservations were backed by active
  // inventory-lot allocations BEFORE cancelling, so we can re-sync them to 0.
  const directRows = await tx
    .select({
      salesOrderLineId: stockAllocations.demandId,
      itemId: stockAllocations.itemId,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.sourceType, "inventory_lot")
      )
    );

  const shipmentRows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      itemId: stockAllocations.itemId,
    })
    .from(stockAllocations)
    .innerJoin(salesShipmentLines, eq(stockAllocations.demandId, salesShipmentLines.id))
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(stockAllocations.sourceType, "inventory_lot")
      )
    );

  const affectedSalesLines = new Map<string, { salesOrderLineId: string; itemId: string }>();
  for (const row of [...directRows, ...shipmentRows]) {
    affectedSalesLines.set(`${row.salesOrderLineId}:${row.itemId}`, {
      salesOrderLineId: row.salesOrderLineId,
      itemId: row.itemId,
    });
  }

  await cancelActiveStockAllocationsInTx(tx, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId ?? null,
  });

  for (const line of affectedSalesLines.values()) {
    await syncSalesLineAllocationReservationInTx(tx, {
      organizationId: params.organizationId,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      actorUserId: params.actorUserId ?? null,
    });
  }
}
