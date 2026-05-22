import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import {
  SalesAllocationTable,
  type AllocationPoolRow,
} from "@/app/(dashboard)/sales/sales-allocation-table";
import { DemandQueueCoverageTable } from "@/app/(dashboard)/sales/demand-queue-coverage-table";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import {
  getDemandQueueCoverageForItemInTx,
  type DemandQueueItemCoverage,
} from "@/lib/inventory/allocation/demand-queue";
import {
  getManufacturingAllocationDemandRowsInTx,
  type ManufacturingAllocationDemandRow,
} from "@/lib/inventory/allocation/manufacturing-demands";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";
import OrdersTableLoading from "../orders-table-loading";

export default function SalesAllocationPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <SalesAllocationData />
    </Suspense>
  );
}

async function SalesAllocationData() {
  const [context, orders] = await Promise.all([
    getAuthedMemberContext(),
    getSalesOrders(),
  ]);
  const salesProductIds = orders
    .filter((order) => order.status === "open")
    .flatMap((order) =>
      order.lines
        .filter((line) => line.itemType === "product")
        .map((line) => line.itemId)
    );

  const canReadManufacturing = hasModuleAccess(
    context.assignedRoles,
    "manufacturing",
    "read"
  );

  if (context.allocationMode === "demand_queue") {
    const coverage = await getDemandQueueCoverage(salesProductIds, canReadManufacturing);
    return <DemandQueueCoverageTable coverage={coverage} />;
  }

  const [initialPools, manufacturingDemandRows] = await Promise.all([
    getInitialAllocationPools(salesProductIds, canReadManufacturing),
    canReadManufacturing
      ? getInitialManufacturingDemandRows(salesProductIds)
      : Promise.resolve([] as ManufacturingAllocationDemandRow[]),
  ]);
  return (
    <SalesAllocationTable
      initialData={orders}
      initialPools={initialPools}
      initialManufacturingDemandRows={manufacturingDemandRows}
      organizationId={context.orgId}
    />
  );
}

async function getDemandQueueCoverage(
  salesProductIds: string[],
  canReadManufacturing: boolean
): Promise<DemandQueueItemCoverage[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    // Manufacturing-only items (no sales demand) are only surfaced to users who
    // can read manufacturing. Sales-only users see sales-relevant items, where
    // manufacturing demand still reduces sellable quantity but its identity is
    // withheld (includeManufacturingDetail = false).
    let itemIds = [...new Set(salesProductIds)];
    if (canReadManufacturing) {
      const manufacturingDemandRows = await getManufacturingAllocationDemandRowsInTx(
        tx,
        orgId
      );
      const manufacturingItemIds = manufacturingDemandRows.flatMap((row) =>
        row.ingredients.map((ingredient) => ingredient.itemId)
      );
      itemIds = [...new Set([...salesProductIds, ...manufacturingItemIds])];
    }

    const coverage: DemandQueueItemCoverage[] = [];
    for (const itemId of itemIds) {
      const itemCoverage = await getDemandQueueCoverageForItemInTx(tx, {
        organizationId: orgId,
        itemId,
        includeManufacturingDetail: canReadManufacturing,
      });
      if (itemCoverage) coverage.push(itemCoverage);
    }

    return coverage.sort((left, right) => {
      const shortCompare = Number(right.shortQty) - Number(left.shortQty);
      if (shortCompare !== 0) return shortCompare;
      return left.itemName.localeCompare(right.itemName);
    });
  });
}

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

async function getInitialAllocationPools(
  itemIds: string[],
  includeManufacturingDemand: boolean
): Promise<AllocationPoolRow[]> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return [];

  return withAuthedOrgContext(async (tx, orgId) => {
    const rows: AllocationPoolRow[] = [];

    for (const itemId of uniqueItemIds) {
      const workspace = await getAllocationWorkspaceInTx(tx, {
        organizationId: orgId,
        itemId,
        includeManufacturingDemand,
      });

      if (!workspace) {
        rows.push({
          itemId,
          stockQty: "0",
          incomingQty: "0",
          allocatedQty: "0",
          totalDemandQty: "0",
          assignments: [],
          reservations: [],
        });
        continue;
      }

      const stockQty = workspace.sources
        .filter((source) => source.sourceType === "inventory_lot")
        .reduce((sum, source) => sum + toQuantity(source.totalQty), 0);
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
          demandLabel: assignment.demandLabel,
          quantity: assignment.quantity,
        })),
        reservations: [],
      });
    }

    return rows;
  });
}

async function getInitialManufacturingDemandRows(
  itemIds: string[]
): Promise<ManufacturingAllocationDemandRow[]> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return [];

  return withAuthedOrgContext((tx, orgId) =>
    getManufacturingAllocationDemandRowsInTx(tx, orgId, uniqueItemIds)
  );
}
