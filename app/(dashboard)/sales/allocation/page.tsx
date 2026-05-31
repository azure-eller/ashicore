import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import {
  SalesAllocationTable,
  type AllocationPoolRow,
} from "@/app/(dashboard)/sales/sales-allocation-table";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import {
  getManufacturingAllocationDemandRowsInTx,
  type ManufacturingAllocationDemandRow,
} from "@/lib/inventory/allocation/manufacturing-demands";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "@/lib/inventory/allocation/format";
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

  const manufacturingDemandRows = canReadManufacturing
    ? await getInitialManufacturingDemandRows()
    : [];
  const allocationItemIds = [
    ...salesProductIds,
    ...manufacturingDemandRows.flatMap((row) =>
      row.ingredients.map((ingredient) => ingredient.itemId)
    ),
  ];
  const initialPools = await getInitialAllocationPools(
    allocationItemIds,
    canReadManufacturing
  );
  return (
    <SalesAllocationTable
      initialData={orders}
      initialPools={initialPools}
      initialManufacturingDemandRows={manufacturingDemandRows}
      organizationId={context.orgId}
    />
  );
}

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

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

async function getInitialManufacturingDemandRows(): Promise<
  ManufacturingAllocationDemandRow[]
> {
  return withAuthedOrgContext((tx, orgId) =>
    getManufacturingAllocationDemandRowsInTx(tx, orgId)
  );
}
