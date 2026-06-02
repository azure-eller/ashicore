import { Suspense } from "react";
import { getOpenSalesProductItemIds } from "@/app/(dashboard)/sales/queries";
import { DemandQueueCoverageTable } from "@/app/(dashboard)/sales/demand-queue-coverage-table";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import {
  getDemandQueueCoverageForItemsInTx,
  getOpenManufacturingIngredientItemIdsInTx,
} from "@/lib/inventory/allocation/demand-queue";
import OrdersTableLoading from "../orders-table-loading";

export default async function SalesAllocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const itemId =
    typeof resolvedSearchParams.itemId === "string"
      ? resolvedSearchParams.itemId
      : null;

  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <SalesAllocationData itemId={itemId} />
    </Suspense>
  );
}

async function SalesAllocationData({ itemId }: { itemId: string | null }) {
  const [context, salesProductIds] = await Promise.all([
    getAuthedMemberContext(),
    itemId ? Promise.resolve([itemId]) : getOpenSalesProductItemIds(),
  ]);

  const canReadManufacturing = hasModuleAccess(
    context.assignedRoles,
    "manufacturing",
    "read"
  );

  const manufacturingIngredientItemIds =
    itemId || !canReadManufacturing
      ? []
      : await getOpenManufacturingIngredientItemIds();
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
