import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import {
  SalesAllocationTable,
  type AllocationPoolRow,
} from "@/app/(dashboard)/sales/sales-allocation-table";
import { withAuthedOrgContext } from "@/lib/dal/auth";
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
  const orders = await getSalesOrders();
  const initialPools = await getInitialAllocationPools(
    orders.flatMap((order) =>
      order.lines
        .filter((line) => line.itemType === "product")
        .map((line) => line.itemId)
    )
  );
  return <SalesAllocationTable initialData={orders} initialPools={initialPools} />;
}

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

async function getInitialAllocationPools(itemIds: string[]): Promise<AllocationPoolRow[]> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return [];

  return withAuthedOrgContext(async (tx, orgId) => {
    const rows: AllocationPoolRow[] = [];

    for (const itemId of uniqueItemIds) {
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
          reservations: [],
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
          demandLabel: assignment.demandLabel,
          quantity: assignment.quantity,
        })),
        reservations: [],
      });
    }

    return rows;
  });
}
