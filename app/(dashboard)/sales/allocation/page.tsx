import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import {
  SalesAllocationTable,
  type ManufacturingAllocationDemandRow,
  type ProductCoverageRow,
} from "@/app/(dashboard)/sales/sales-allocation-table";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import {
  getDemandQueueCoverageForItemsInTx,
  getOpenManufacturingIngredientItemIdsInTx,
  type DemandQueueCoverageDemand,
  type DemandQueueItemCoverage,
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

  const manufacturingDemandRows = canReadManufacturing
    ? await getOpenManufacturingIngredientItemIds()
    : [];
  const allocationItemIds = [
    ...salesProductIds,
    ...manufacturingDemandRows,
  ];
  const coverage = await getInitialDemandQueueCoverage(
    allocationItemIds,
    canReadManufacturing
  );
  return (
    <SalesAllocationTable
      initialData={orders}
      initialProductCoverage={buildProductCoverageFromDemandQueue(coverage)}
      initialManufacturingDemandRows={buildManufacturingRowsFromCoverage(coverage)}
      organizationId={context.orgId}
    />
  );
}

async function getInitialDemandQueueCoverage(
  itemIds: string[],
  includeManufacturingDetail: boolean
): Promise<DemandQueueItemCoverage[]> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) return [];

  return withAuthedOrgContext((tx, orgId) =>
    getDemandQueueCoverageForItemsInTx(tx, {
      organizationId: orgId,
      itemIds: uniqueItemIds,
      includeManufacturingDetail,
    })
  );
}

async function getOpenManufacturingIngredientItemIds(): Promise<string[]> {
  return withAuthedOrgContext((tx, orgId) =>
    getOpenManufacturingIngredientItemIdsInTx(tx, orgId)
  );
}

function buildProductCoverageFromDemandQueue(
  coverage: DemandQueueItemCoverage[]
): ProductCoverageRow[] {
  return coverage.map((item) => ({
    itemId: item.itemId,
    stockQty: item.onHandQty,
    incomingQty: item.expectedQty,
    sources: item.sources,
  }));
}

function manufacturingOrderIdFromDemand(demand: DemandQueueCoverageDemand) {
  return demand.href?.split("/").filter(Boolean).at(-1) ?? demand.demandId;
}

function buildManufacturingRowsFromCoverage(
  coverage: DemandQueueItemCoverage[]
): ManufacturingAllocationDemandRow[] {
  const rowsByOrderId = new Map<string, ManufacturingAllocationDemandRow>();

  for (const item of coverage) {
    for (const demand of item.demands) {
      if (demand.demandType !== "manufacturing_order_ingredient") continue;

      const orderId = manufacturingOrderIdFromDemand(demand);
      const row =
        rowsByOrderId.get(orderId) ??
        ({
          id: `manufacturing:${orderId}`,
          orderId,
          orderNumber: demand.label,
          productName: demand.contextLabel ?? demand.label,
          plannedDate: demand.requiredDate,
          href: demand.href ?? null,
          ingredients: [],
        } satisfies ManufacturingAllocationDemandRow);
      rowsByOrderId.set(orderId, row);

      row.ingredients.push({
        id: demand.demandId,
        itemId: item.itemId,
        itemName: item.itemName,
        itemSku: null,
        unitName: item.unitName,
        plannedQty: demand.requiredQty,
        pickedQty: "0",
        openQty: demand.requiredQty,
        allocatedQty: demand.inStockQty,
        shortQty: demand.shortQty,
        segments: demand.segments,
      });
    }
  }

  return [...rowsByOrderId.values()];
}
