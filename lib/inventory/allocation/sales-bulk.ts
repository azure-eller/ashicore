import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { items, salesOrderLines, salesOrders } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { saveAllocationsForDemandInTx } from "./commands";
import { getAllocationWorkspaceInTx } from "./read-model";
import type {
  AllocationAssignment,
  AllocationDemandRow,
  AllocationSourceRef,
} from "./types";
import { sourceKey } from "./types";

const OPEN_SALES_STATUSES = ["open"] as const;

type BulkAllocationSummary = {
  itemCount: number;
  lineCount: number;
  quantity: string;
};

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function compareSalesDemandPriority(
  left: AllocationDemandRow,
  right: AllocationDemandRow
) {
  const leftDate = left.requiredDate ?? "9999-12-31";
  const rightDate = right.requiredDate ?? "9999-12-31";
  const dateCompare = leftDate.localeCompare(rightDate);
  if (dateCompare !== 0) return dateCompare;
  return left.label.localeCompare(right.label, undefined, { numeric: true });
}

async function getOpenSalesProductItemIdsInTx(
  tx: Tx,
  organizationId: string
) {
  const rows = await tx
    .select({ itemId: salesOrderLines.itemId })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .innerJoin(items, eq(salesOrderLines.itemId, items.id))
    .where(
      and(
        eq(salesOrders.organizationId, organizationId),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, [...OPEN_SALES_STATUSES]),
        eq(items.itemType, "product"),
        isNull(items.deletedAt)
      )
    );

  return [...new Set(rows.map((row) => row.itemId))];
}

function mergeAllocations(
  currentAssignments: AllocationAssignment[],
  additions: Array<AllocationSourceRef & { quantity: number }>
) {
  const bySource = new Map<
    string,
    AllocationSourceRef & { quantity: number }
  >();

  for (const assignment of currentAssignments) {
    const key = sourceKey(assignment);
    bySource.set(key, {
      sourceType: assignment.sourceType,
      sourceId: assignment.sourceId,
      quantity: toQuantity(assignment.quantity),
    });
  }

  for (const addition of additions) {
    const key = sourceKey(addition);
    const existing = bySource.get(key);
    bySource.set(key, {
      sourceType: addition.sourceType,
      sourceId: addition.sourceId,
      quantity: roundQuantity((existing?.quantity ?? 0) + addition.quantity),
    });
  }

  return [...bySource.values()]
    .filter((allocation) => allocation.quantity > 0)
    .map((allocation) => ({
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
      quantity: quantityString(allocation.quantity),
    }));
}

async function bulkAllocateOpenSalesOrdersFifoInTx(
  tx: Tx,
  params: { organizationId: string; actorUserId: string }
): Promise<BulkAllocationSummary> {
  const itemIds = await getOpenSalesProductItemIdsInTx(tx, params.organizationId);
  let lineCount = 0;
  let totalAllocated = 0;

  for (const itemId of itemIds) {
    const workspace = await getAllocationWorkspaceInTx(tx, {
      organizationId: params.organizationId,
      itemId,
    });
    if (!workspace) continue;

    const lotSources = workspace.sources.filter(
      (source) => source.sourceType === "inventory_lot"
    );
    const freeBySource = new Map(
      lotSources.map((source) => [source.sourceKey, toQuantity(source.freeQty)])
    );
    const salesDemands = workspace.demands
      .filter(
        (demand) =>
          demand.demandType === "sales_shipment_line" ||
          demand.demandType === "sales_order_line"
      )
      .sort(compareSalesDemandPriority);

    for (const demand of salesDemands) {
      let remaining = toQuantity(demand.shortQty);
      if (remaining <= 0) continue;

      const additions: Array<AllocationSourceRef & { quantity: number }> = [];
      for (const source of lotSources) {
        const freeQty = freeBySource.get(source.sourceKey) ?? 0;
        const quantity = roundQuantity(Math.min(freeQty, remaining));
        if (quantity <= 0) continue;

        additions.push({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          quantity,
        });
        freeBySource.set(source.sourceKey, roundQuantity(freeQty - quantity));
        remaining = roundQuantity(remaining - quantity);
        totalAllocated = roundQuantity(totalAllocated + quantity);
        if (remaining <= 0) break;
      }

      if (additions.length === 0) continue;

      await saveAllocationsForDemandInTx(tx, {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        demandType: demand.demandType,
        demandId: demand.demandId,
        itemId: demand.itemId,
        allocations: mergeAllocations(demand.assignments, additions),
        returnWorkspace: false,
      });
      lineCount += 1;
    }
  }

  return {
    itemCount: itemIds.length,
    lineCount,
    quantity: quantityString(totalAllocated),
  };
}

async function bulkUnallocateOpenSalesOrdersInTx(
  tx: Tx,
  params: { organizationId: string; actorUserId: string }
): Promise<BulkAllocationSummary> {
  const itemIds = await getOpenSalesProductItemIdsInTx(tx, params.organizationId);
  let lineCount = 0;
  let totalUnallocated = 0;

  for (const itemId of itemIds) {
    const workspace = await getAllocationWorkspaceInTx(tx, {
      organizationId: params.organizationId,
      itemId,
    });
    if (!workspace) continue;

    const salesDemands = workspace.demands.filter(
      (demand) =>
        (demand.demandType === "sales_shipment_line" ||
          demand.demandType === "sales_order_line") &&
        demand.assignments.length > 0
    );

    for (const demand of salesDemands) {
      totalUnallocated = roundQuantity(
        totalUnallocated +
          demand.assignments.reduce(
            (sum, assignment) => sum + toQuantity(assignment.quantity),
            0
          )
      );

      await saveAllocationsForDemandInTx(tx, {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        demandType: demand.demandType,
        demandId: demand.demandId,
        itemId: demand.itemId,
        allocations: [],
        returnWorkspace: false,
      });
      lineCount += 1;
    }
  }

  return {
    itemCount: itemIds.length,
    lineCount,
    quantity: quantityString(totalUnallocated),
  };
}

export async function bulkAllocateOpenSalesOrdersFifo() {
  return withAuthedOrgContext((tx, organizationId, actorUserId) =>
    bulkAllocateOpenSalesOrdersFifoInTx(tx, {
      organizationId,
      actorUserId,
    })
  );
}

export async function bulkUnallocateOpenSalesOrders() {
  return withAuthedOrgContext((tx, organizationId, actorUserId) =>
    bulkUnallocateOpenSalesOrdersInTx(tx, {
      organizationId,
      actorUserId,
    })
  );
}
