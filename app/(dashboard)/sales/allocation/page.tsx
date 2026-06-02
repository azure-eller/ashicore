import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import { DemandQueueCoverageTable } from "@/app/(dashboard)/sales/demand-queue-coverage-table";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import {
  getDemandQueueCoverageForItemsInTx,
  getOpenManufacturingIngredientItemIdsInTx,
} from "@/lib/inventory/allocation/demand-queue";
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

  const manufacturingIngredientItemIds = canReadManufacturing
    ? await getOpenManufacturingIngredientItemIds()
    : [];
  const allocationItemIds = [
    ...salesProductIds,
    ...manufacturingIngredientItemIds,
  ];
  const coverage = await withAuthedOrgContext((tx, orgId) =>
    getDemandQueueCoverageForItemsInTx(tx, {
      organizationId: orgId,
      itemIds: allocationItemIds,
      includeManufacturingDetail: canReadManufacturing,
    })
  );
  return <DemandQueueCoverageTable coverage={coverage} />;
}

async function getOpenManufacturingIngredientItemIds(): Promise<string[]> {
  return withAuthedOrgContext((tx, orgId) =>
    getOpenManufacturingIngredientItemIdsInTx(tx, orgId)
  );
}
