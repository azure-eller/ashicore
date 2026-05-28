import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  inventoryLotBalances,
  items,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  stockAllocations,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import {
  calculateIngredientPlannedQuantity,
  normalizeRecipeBasis,
} from "@/lib/manufacturing/consumption";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { roundQuantity } from "@/lib/format";
import type {
  SalesIngredientsFulfillmentState,
  SalesItemsFulfillmentState,
  SalesProductionFulfillmentState,
} from "@/lib/sales/fulfillment-status";
export { getAvailabilityLabel } from "@/lib/sales/fulfillment-status";

export type SalesFulfillmentReadModel = {
  salesItemsState: SalesItemsFulfillmentState;
  salesItemsExpectedDate: string | null;
  ingredientsState: SalesIngredientsFulfillmentState;
  ingredientsExpectedDate: string | null;
  ingredientShortages: SalesIngredientShortageSummary[];
  productionState: SalesProductionFulfillmentState;
};

export type SalesIngredientShortageSummary = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  requiredQty: number;
  shortQty: number;
};

export type SalesFulfillmentDemandLine = {
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  requiredDate: string | null;
  quantity: number;
  priorityRank: number | null;
  orderDate: string;
  orderNumber: string;
  sortOrder: number;
};

export type SalesFulfillmentOrderInput = {
  id: string;
  status: string;
  hasManufacturableLines: boolean;
  shortQty: number;
  productionAllocatedQty: number;
  linkedManufacturingOrders: Array<{
    id: string;
    salesOrderLineId?: string | null;
    status: "open" | "done";
    productionStatus: "not_started" | "blocked" | "in_progress" | "done";
  }>;
  manufacturableLines: Array<{
    salesOrderId: string;
    salesOrderLineId: string;
    itemId: string;
    quantity: string;
    manufacturingMode: string;
    expectedBatchYield: string | null;
    status: "will_create" | "skipped";
  }>;
};

type AvailabilitySummary = Pick<
  SalesFulfillmentReadModel,
  "salesItemsState" | "salesItemsExpectedDate"
>;

type AvailabilitySupplySlice = {
  itemId: string;
  quantity: number;
  expectedDate: string | null;
  linkedSalesOrderLineId?: string | null;
};

type IngredientSupplySlice = {
  itemId: string;
  quantity: number;
  expectedDate: string | null;
};

type IngredientNeed = {
  salesOrderId: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: number;
};

type IngredientCoverage = {
  state: Exclude<
    SalesIngredientsFulfillmentState,
    "not_needed" | "not_applicable" | "picked"
  >;
  expectedDate: string | null;
};

function parseQuantity(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareAvailabilityLines(
  left: SalesFulfillmentDemandLine,
  right: SalesFulfillmentDemandLine
) {
  const rankCompare =
    (left.priorityRank ?? Number.MAX_SAFE_INTEGER) -
    (right.priorityRank ?? Number.MAX_SAFE_INTEGER);
  if (rankCompare !== 0) return rankCompare;

  const requiredDateCompare = (left.requiredDate ?? "9999-12-31").localeCompare(
    right.requiredDate ?? "9999-12-31"
  );
  if (requiredDateCompare !== 0) return requiredDateCompare;

  const orderDateCompare = left.orderDate.localeCompare(right.orderDate);
  if (orderDateCompare !== 0) return orderDateCompare;

  const orderCompare = left.orderNumber.localeCompare(right.orderNumber, undefined, {
    numeric: true,
  });
  if (orderCompare !== 0) return orderCompare;

  return left.sortOrder - right.sortOrder;
}

function expectedSupplyCanCoverDemand(
  supply: AvailabilitySupplySlice,
  demand: SalesFulfillmentDemandLine
) {
  if (supply.expectedDate == null) return demand.requiredDate == null;
  if (demand.requiredDate == null) return true;
  return supply.expectedDate <= demand.requiredDate;
}

function applyAvailabilitySupply(
  demand: SalesFulfillmentDemandLine,
  supplies: AvailabilitySupplySlice[],
  options: { ignoreRequiredDate?: boolean } = {}
) {
  let remaining = demand.quantity;
  let expectedDate: string | null = null;

  for (const supply of supplies) {
    if (remaining <= 0) break;
    if (supply.quantity <= 0) continue;
    if (
      !options.ignoreRequiredDate &&
      supply.expectedDate != null &&
      !expectedSupplyCanCoverDemand(supply, demand)
    ) {
      continue;
    }

    const consumed = Math.min(remaining, supply.quantity);
    supply.quantity = roundQuantity(supply.quantity - consumed);
    remaining = roundQuantity(remaining - consumed);
    if (supply.expectedDate != null) {
      expectedDate =
        [expectedDate, supply.expectedDate]
          .filter((date): date is string => date != null)
          .sort()
          .at(-1) ?? null;
    }
  }

  return { covered: remaining <= 0, expectedDate, remaining };
}

async function getSalesItemAvailabilityByOrderIdInTx(
  tx: Tx,
  orgId: string,
  demandLines: SalesFulfillmentDemandLine[]
): Promise<Map<string, AvailabilitySummary>> {
  const positiveDemandLines = demandLines.filter((line) => line.quantity > 0);
  if (positiveDemandLines.length === 0) {
    return new Map();
  }

  const itemIds = [...new Set(positiveDemandLines.map((line) => line.itemId))];
  const currentSupplyRows = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .groupBy(inventoryLotBalances.itemId);

  const purchaseSupplyRows = await tx
    .select({
      itemId: purchaseOrderLines.itemId,
      expectedDate: purchaseOrders.expectedDate,
      quantity: trimScale(
        sql`COALESCE(SUM(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}), 0)`
      ).as("quantity"),
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrderLines.itemId, itemIds)
      )
    )
    .groupBy(purchaseOrderLines.itemId, purchaseOrders.expectedDate);

  const manufacturingSupplyRows = await tx
    .select({
      id: manufacturingOrders.id,
      itemId: manufacturingOrders.productId,
      expectedDate: manufacturingOrders.plannedDate,
      linkedSalesOrderLineId: manufacturingOrders.salesOrderLineId,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0)), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        inArray(manufacturingOrders.productId, itemIds)
      )
    )
    .groupBy(
      manufacturingOrders.id,
      manufacturingOrders.productId,
      manufacturingOrders.plannedDate,
      manufacturingOrders.salesOrderLineId
    );

  const demandLineIds = positiveDemandLines.map((line) => line.salesOrderLineId);
  const activeAllocationRows = await tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      itemId: stockAllocations.itemId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, orgId),
        eq(stockAllocations.status, "active"),
        inArray(stockAllocations.itemId, itemIds)
      )
    );
  const manufacturingIngredientDemandRows = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      quantity: trimScale(
        sql`COALESCE(SUM(GREATEST(${manufacturingOrderIngredients.plannedQuantity} - ${manufacturingOrderIngredients.pickedQuantity}, 0)), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        inArray(manufacturingOrderIngredients.itemId, itemIds),
        sql`${manufacturingOrderIngredients.plannedQuantity} > ${manufacturingOrderIngredients.pickedQuantity}`
      )
    )
    .groupBy(manufacturingOrderIngredients.itemId);
  const allocatedInventoryQtyByItemId = new Map<string, number>();
  const allocatedManufacturingQtyByOrderId = new Map<string, number>();
  const allocatedManufacturingIngredientQtyByItemId = new Map<string, number>();
  const manualSalesLineAllocations = activeAllocationRows.filter(
    (row) =>
      row.demandType === "sales_order_line" &&
      demandLineIds.includes(row.demandId)
  );

  for (const row of activeAllocationRows) {
    const quantity = parseQuantity(row.quantity);
    if (quantity <= 0) continue;
    if (row.sourceType === "inventory_lot") {
      allocatedInventoryQtyByItemId.set(
        row.itemId,
        roundQuantity((allocatedInventoryQtyByItemId.get(row.itemId) ?? 0) + quantity)
      );
      if (row.demandType === "manufacturing_order_ingredient") {
        allocatedManufacturingIngredientQtyByItemId.set(
          row.itemId,
          roundQuantity(
            (allocatedManufacturingIngredientQtyByItemId.get(row.itemId) ?? 0) +
              quantity
          )
        );
      }
    } else if (row.sourceType === "manufacturing_order") {
      allocatedManufacturingQtyByOrderId.set(
        row.sourceId,
        roundQuantity(
          (allocatedManufacturingQtyByOrderId.get(row.sourceId) ?? 0) + quantity
        )
      );
    }
  }

  const manualManufacturingSourceIds = [
    ...new Set(
      manualSalesLineAllocations
        .filter((row) => row.sourceType === "manufacturing_order")
        .map((row) => row.sourceId)
    ),
  ];
  const manualManufacturingSources =
    manualManufacturingSourceIds.length > 0
      ? await tx
          .select({
            id: manufacturingOrders.id,
            plannedDate: manufacturingOrders.plannedDate,
            salesOrderLineId: manufacturingOrders.salesOrderLineId,
          })
          .from(manufacturingOrders)
          .where(inArray(manufacturingOrders.id, manualManufacturingSourceIds))
      : [];
  const manualManufacturingSourceById = new Map(
    manualManufacturingSources.map((source) => [source.id, source])
  );
  const manualSupplyByLineId = new Map<string, AvailabilitySupplySlice[]>();

  for (const row of manualSalesLineAllocations) {
    const quantity = parseQuantity(row.quantity);
    if (quantity <= 0) continue;
    if (row.sourceType === "manufacturing_order") {
      const source = manualManufacturingSourceById.get(row.sourceId);
      if (!source) continue;
      if (source.salesOrderLineId != null && source.salesOrderLineId !== row.demandId) {
        continue;
      }
      manualSupplyByLineId.set(row.demandId, [
        ...(manualSupplyByLineId.get(row.demandId) ?? []),
        {
          itemId: row.itemId,
          quantity,
          expectedDate: source.plannedDate,
          linkedSalesOrderLineId: row.demandId,
        },
      ]);
      continue;
    }

    manualSupplyByLineId.set(row.demandId, [
      ...(manualSupplyByLineId.get(row.demandId) ?? []),
      {
        itemId: row.itemId,
        quantity,
        expectedDate: null,
        linkedSalesOrderLineId: row.demandId,
      },
    ]);
  }

  const supplyByItem = new Map<string, AvailabilitySupplySlice[]>();
  const linkedManufacturingSupplyByLineId = new Map<string, AvailabilitySupplySlice[]>();
  const implicitManufacturingIngredientDemandByItemId = new Map<string, number>();
  for (const row of manufacturingIngredientDemandRows) {
    const quantity = roundQuantity(
      parseQuantity(row.quantity) -
        (allocatedManufacturingIngredientQtyByItemId.get(row.itemId) ?? 0)
    );
    if (quantity <= 0) continue;
    implicitManufacturingIngredientDemandByItemId.set(row.itemId, quantity);
  }

  for (const row of currentSupplyRows) {
    const quantity = roundQuantity(
      Number(row.quantity) -
        (allocatedInventoryQtyByItemId.get(row.itemId) ?? 0) -
        (implicitManufacturingIngredientDemandByItemId.get(row.itemId) ?? 0)
    );
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    supplyByItem.set(row.itemId, [
      ...(supplyByItem.get(row.itemId) ?? []),
      { itemId: row.itemId, quantity, expectedDate: null },
    ]);
  }

  for (const row of purchaseSupplyRows) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const supply: AvailabilitySupplySlice = {
      itemId: row.itemId,
      quantity,
      expectedDate: row.expectedDate,
    };
    supplyByItem.set(row.itemId, [...(supplyByItem.get(row.itemId) ?? []), supply]);
  }

  for (const row of manufacturingSupplyRows) {
    const quantity = roundQuantity(
      Number(row.quantity) - (allocatedManufacturingQtyByOrderId.get(row.id) ?? 0)
    );
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const linkedSalesOrderLineId =
      typeof row.linkedSalesOrderLineId === "string" ? row.linkedSalesOrderLineId : null;
    const supply: AvailabilitySupplySlice = {
      itemId: row.itemId,
      quantity,
      expectedDate: row.expectedDate,
      linkedSalesOrderLineId,
    };
    if (supply.linkedSalesOrderLineId) {
      linkedManufacturingSupplyByLineId.set(supply.linkedSalesOrderLineId, [
        ...(linkedManufacturingSupplyByLineId.get(supply.linkedSalesOrderLineId) ?? []),
        supply,
      ]);
    } else {
      supplyByItem.set(row.itemId, [...(supplyByItem.get(row.itemId) ?? []), supply]);
    }
  }

  for (const supplies of supplyByItem.values()) {
    supplies.sort((left, right) => {
      if (left.expectedDate == null && right.expectedDate != null) return -1;
      if (left.expectedDate != null && right.expectedDate == null) return 1;
      return (left.expectedDate ?? "9999-12-31").localeCompare(
        right.expectedDate ?? "9999-12-31"
      );
    });
  }

  const lineResults = new Map<
    string,
    { covered: boolean; expectedDate: string | null }
  >();
  for (const demand of [...positiveDemandLines].sort(compareAvailabilityLines)) {
    const linkedResult = applyAvailabilitySupply(
      demand,
      [
        ...(manualSupplyByLineId.get(demand.salesOrderLineId) ?? []),
        ...(linkedManufacturingSupplyByLineId.get(demand.salesOrderLineId) ?? []),
      ],
      { ignoreRequiredDate: true }
    );
    if (linkedResult.covered) {
      lineResults.set(demand.salesOrderLineId, linkedResult);
      continue;
    }

    const genericResult = applyAvailabilitySupply(
      { ...demand, quantity: linkedResult.remaining },
      supplyByItem.get(demand.itemId) ?? []
    );
    lineResults.set(demand.salesOrderLineId, {
      covered: genericResult.covered,
      expectedDate:
        [linkedResult.expectedDate, genericResult.expectedDate]
          .filter((date): date is string => date != null)
          .sort()
          .at(-1) ?? null,
    });
  }

  const lineResultsByOrderId = new Map<
    string,
    Array<{ covered: boolean; expectedDate: string | null }>
  >();
  for (const line of positiveDemandLines) {
    const result = lineResults.get(line.salesOrderLineId);
    if (!result) continue;
    lineResultsByOrderId.set(line.salesOrderId, [
      ...(lineResultsByOrderId.get(line.salesOrderId) ?? []),
      result,
    ]);
  }

  const summaries = new Map<string, AvailabilitySummary>();
  for (const [salesOrderId, results] of lineResultsByOrderId) {
    const coveredResults = results.filter((result) => result.covered);
    const expectedDates = coveredResults
      .map((result) => result.expectedDate)
      .filter((date): date is string => date != null);

    summaries.set(salesOrderId, {
      salesItemsState:
        coveredResults.length !== results.length
          ? "not_available"
          : expectedDates.length > 0
            ? "expected"
            : "available",
      salesItemsExpectedDate: expectedDates.sort().at(-1) ?? null,
    });
  }

  return summaries;
}

function deriveProductionState(
  order: Pick<
    SalesFulfillmentOrderInput,
    | "linkedManufacturingOrders"
    | "hasManufacturableLines"
    | "shortQty"
    | "productionAllocatedQty"
  >
): SalesProductionFulfillmentState {
  const linkedOpenOrders = order.linkedManufacturingOrders.filter(
    (linkedOrder) => linkedOrder.status === "open"
  );
  const hasLinkedManufacturingOrders = order.linkedManufacturingOrders.length > 0;

  if (linkedOpenOrders.some((mo) => mo.productionStatus === "blocked")) {
    return "blocked";
  }

  if (linkedOpenOrders.some((mo) => mo.productionStatus === "in_progress")) {
    return "in_progress";
  }

  if (linkedOpenOrders.some((mo) => mo.productionStatus === "not_started")) {
    return "not_started";
  }

  if (
    hasLinkedManufacturingOrders &&
    order.linkedManufacturingOrders.every((mo) => mo.productionStatus === "done")
  ) {
    return "done";
  }

  if (order.hasManufacturableLines && order.shortQty > 0) {
    return "make";
  }

  return "not_applicable";
}

function rollupIngredientCoverages(
  coverages: IngredientCoverage[]
): Pick<SalesFulfillmentReadModel, "ingredientsState" | "ingredientsExpectedDate"> {
  if (coverages.length === 0) {
    return { ingredientsState: "not_applicable", ingredientsExpectedDate: null };
  }

  if (coverages.some((coverage) => coverage.state === "not_available")) {
    return { ingredientsState: "not_available", ingredientsExpectedDate: null };
  }

  const expectedDates = coverages
    .map((coverage) => coverage.expectedDate)
    .filter((date): date is string => date != null);

  if (coverages.some((coverage) => coverage.state === "expected")) {
    return {
      ingredientsState: "expected",
      ingredientsExpectedDate: expectedDates.sort().at(-1) ?? null,
    };
  }

  return { ingredientsState: "in_stock", ingredientsExpectedDate: null };
}

function coverageForNeeds(
  needs: IngredientNeed[],
  supplyByItemId: Map<string, IngredientSupplySlice[]>
) {
  const coverages: IngredientCoverage[] = [];
  const shortages: SalesIngredientShortageSummary[] = [];

  for (const need of needs) {
    let remaining = need.quantity;
    let expectedDate: string | null = null;
    let consumedExpected = false;
    const supplies = supplyByItemId.get(need.itemId) ?? [];

    for (const supply of supplies.filter((slice) => slice.expectedDate == null)) {
      if (remaining <= 0) break;
      if (supply.quantity <= 0) continue;

      const consumed = Math.min(remaining, supply.quantity);
      supply.quantity = roundQuantity(supply.quantity - consumed);
      remaining = roundQuantity(remaining - consumed);
    }

    const currentShortQty = remaining;
    if (currentShortQty > 0) {
      shortages.push({
        itemId: need.itemId,
        itemName: need.itemName,
        itemSku: need.itemSku,
        unitName: need.unitName,
        requiredQty: need.quantity,
        shortQty: currentShortQty,
      });
    }

    for (const supply of supplies.filter((slice) => slice.expectedDate != null)) {
      if (remaining <= 0) break;
      if (supply.quantity <= 0) continue;

      const consumed = Math.min(remaining, supply.quantity);
      supply.quantity = roundQuantity(supply.quantity - consumed);
      remaining = roundQuantity(remaining - consumed);
      consumedExpected = true;
      expectedDate =
        [expectedDate, supply.expectedDate]
          .filter((date): date is string => date != null)
          .sort()
          .at(-1) ?? null;
    }

    if (remaining <= 0 && !consumedExpected) {
      coverages.push({ state: "in_stock", expectedDate: null });
      continue;
    }

    if (remaining <= 0) {
      coverages.push({ state: "expected", expectedDate });
      continue;
    }

    coverages.push({ state: "not_available", expectedDate: null });
  }

  return { coverages, shortages };
}

function aggregateNeeds(needs: IngredientNeed[]) {
  const byOrderAndItem = new Map<string, IngredientNeed>();

  for (const need of needs) {
    if (need.quantity <= 0) continue;
    const key = `${need.salesOrderId}:${need.itemId}`;
    const existing = byOrderAndItem.get(key);
    byOrderAndItem.set(key, {
      salesOrderId: need.salesOrderId,
      itemId: need.itemId,
      itemName: need.itemName,
      itemSku: need.itemSku,
      unitName: need.unitName,
      quantity: roundQuantity((existing?.quantity ?? 0) + need.quantity),
    });
  }

  return [...byOrderAndItem.values()];
}

async function getOpenLinkedMoIngredientNeedsInTx(
  tx: Tx,
  orgId: string,
  links: Array<{ salesOrderId: string; manufacturingOrderId: string }>
) {
  const linkedMoIds = [...new Set(links.map((link) => link.manufacturingOrderId))];
  if (linkedMoIds.length === 0) {
    return new Map<string, IngredientNeed[]>();
  }
  const salesOrderIdsByMoId = new Map<string, string[]>();
  for (const link of links) {
    salesOrderIdsByMoId.set(link.manufacturingOrderId, [
      ...(salesOrderIdsByMoId.get(link.manufacturingOrderId) ?? []),
      link.salesOrderId,
    ]);
  }

  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      unitName: manufacturingOrderIngredients.unitName,
      quantity: trimScale(
        sql`COALESCE(SUM(GREATEST(${manufacturingOrderIngredients.plannedQuantity} - ${manufacturingOrderIngredients.pickedQuantity}, 0)), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        inArray(manufacturingOrders.id, linkedMoIds)
      )
    )
    .groupBy(
      manufacturingOrders.id,
      manufacturingOrderIngredients.itemId,
      manufacturingOrderIngredients.itemName,
      manufacturingOrderIngredients.itemSku,
      manufacturingOrderIngredients.unitName
    );

  const bySalesOrderId = new Map<string, IngredientNeed[]>();
  for (const row of rows) {
    const salesOrderIds = salesOrderIdsByMoId.get(row.manufacturingOrderId) ?? [];
    const quantity = parseQuantity(row.quantity);
    if (quantity <= 0) continue;
    for (const salesOrderId of salesOrderIds) {
      bySalesOrderId.set(salesOrderId, [
        ...(bySalesOrderId.get(salesOrderId) ?? []),
        {
          salesOrderId,
          itemId: row.itemId,
          itemName: row.itemName,
          itemSku: row.itemSku,
          unitName: row.unitName,
          quantity,
        },
      ]);
    }
  }

  return bySalesOrderId;
}

async function getBomIngredientNeedsInTx(
  tx: Tx,
  manufacturableLines: SalesFulfillmentOrderInput["manufacturableLines"]
) {
  const activeLines = manufacturableLines.filter(
    (line) => line.status === "will_create" && parseQuantity(line.quantity) > 0
  );
  if (activeLines.length === 0) {
    return [];
  }

  const productIds = [...new Set(activeLines.map((line) => line.itemId))];
  const revisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
      recipeBasis: bomRevisions.recipeBasis,
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, productIds),
        eq(bomRevisions.isCurrent, true)
      )
    );

  if (revisions.length === 0) {
    return [];
  }

  const revisionByProductId = new Map(
    revisions.map((revision) => [revision.productId, revision])
  );
  const components = await tx
    .select({
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentId: bomRevisionComponents.componentId,
      componentName: items.name,
      componentSku: items.sku,
      unitName: unitDefinitions.name,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
    })
    .from(bomRevisionComponents)
    .innerJoin(items, eq(bomRevisionComponents.componentId, items.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(bomRevisionComponents.bomRevisionId, revisions.map((row) => row.id)))
    .orderBy(asc(bomRevisionComponents.sortOrder));

  const componentsByRevisionId = new Map<string, typeof components>();
  for (const component of components) {
    componentsByRevisionId.set(component.bomRevisionId, [
      ...(componentsByRevisionId.get(component.bomRevisionId) ?? []),
      component,
    ]);
  }

  const needs: IngredientNeed[] = [];
  for (const line of activeLines) {
    const revision = revisionByProductId.get(line.itemId);
    if (!revision) continue;

    const outputQuantity = parseQuantity(line.quantity);
    const recipeBasis = normalizeRecipeBasis(revision.recipeBasis);
    const recipeOutputQuantity = parseQuantity(revision.outputQuantity);
    const numberOfBatches =
      recipeBasis === "batch" && recipeOutputQuantity > 0
        ? Math.ceil(outputQuantity / recipeOutputQuantity)
        : null;

    for (const component of componentsByRevisionId.get(revision.id) ?? []) {
      needs.push({
        salesOrderId: line.salesOrderId,
        itemId: component.componentId,
        itemName: component.componentName,
        itemSku: component.componentSku,
        unitName: component.unitName ?? "unit",
        quantity: parseQuantity(
          calculateIngredientPlannedQuantity({
            recipeBasis,
            quantityPerRecipeBasis: component.quantity,
            outputQuantity,
            numberOfBatches,
          })
        ),
      });
    }
  }

  return aggregateNeeds(needs);
}

async function getIngredientSupplyByItemIdInTx(
  tx: Tx,
  orgId: string,
  itemIds: string[]
) {
  const uniqueItemIds = [...new Set(itemIds)];
  const supplyByItemId = new Map<string, IngredientSupplySlice[]>();

  if (uniqueItemIds.length === 0) {
    return supplyByItemId;
  }

  const defaultLocation = await getDefaultInventoryLocationInTx(tx, orgId);
  const currentRows = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        eq(inventoryLotBalances.locationId, defaultLocation.id),
        eq(inventoryLotBalances.disposition, "available"),
        inArray(inventoryLotBalances.itemId, uniqueItemIds)
      )
    )
    .groupBy(inventoryLotBalances.itemId);

  const purchaseSupplyRows = await tx
    .select({
      itemId: purchaseOrderLines.itemId,
      expectedDate: purchaseOrders.expectedDate,
      quantity: trimScale(
        sql`COALESCE(SUM(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}), 0)`
      ).as("quantity"),
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrderLines.itemId, uniqueItemIds)
      )
    )
    .groupBy(purchaseOrderLines.itemId, purchaseOrders.expectedDate);

  const manufacturingSupplyRows = await tx
    .select({
      itemId: manufacturingOrders.productId,
      expectedDate: manufacturingOrders.plannedDate,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0)), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        inArray(manufacturingOrders.productId, uniqueItemIds)
      )
    )
    .groupBy(manufacturingOrders.productId, manufacturingOrders.plannedDate);

  const pushSupply = (supply: IngredientSupplySlice) => {
    if (supply.quantity <= 0) return;
    supplyByItemId.set(supply.itemId, [
      ...(supplyByItemId.get(supply.itemId) ?? []),
      supply,
    ]);
  };

  for (const row of currentRows) {
    pushSupply({
      itemId: row.itemId,
      quantity: parseQuantity(row.quantity),
      expectedDate: null,
    });
  }

  for (const row of [...purchaseSupplyRows, ...manufacturingSupplyRows]) {
    pushSupply({
      itemId: row.itemId,
      quantity: parseQuantity(row.quantity),
      expectedDate: row.expectedDate,
    });
  }

  for (const supplies of supplyByItemId.values()) {
    supplies.sort((left, right) => {
      if (left.expectedDate == null && right.expectedDate != null) return -1;
      if (left.expectedDate != null && right.expectedDate == null) return 1;
      return (left.expectedDate ?? "9999-12-31").localeCompare(
        right.expectedDate ?? "9999-12-31"
      );
    });
  }

  return supplyByItemId;
}

export async function getSalesFulfillmentReadModelsInTx(
  tx: Tx,
  orgId: string,
  orders: SalesFulfillmentOrderInput[],
  demandLines: SalesFulfillmentDemandLine[]
): Promise<Map<string, SalesFulfillmentReadModel>> {
  const availabilityByOrderId = await getSalesItemAvailabilityByOrderIdInTx(
    tx,
    orgId,
    demandLines
  );
  const linkedOpenMoLinks = orders.flatMap((order) =>
    order.linkedManufacturingOrders.flatMap((mo) =>
      mo.status === "open"
        ? [{ salesOrderId: order.id, manufacturingOrderId: mo.id }]
        : []
    )
  );
  const linkedNeedsByOrderId = await getOpenLinkedMoIngredientNeedsInTx(
    tx,
    orgId,
    linkedOpenMoLinks
  );
  const linkedLineIdsByOrderId = new Map<string, Set<string>>();
  for (const order of orders) {
    linkedLineIdsByOrderId.set(
      order.id,
      new Set(
        order.linkedManufacturingOrders
          .map((mo) => mo.salesOrderLineId)
          .filter((lineId): lineId is string => typeof lineId === "string")
      )
    );
  }
  const bomNeeds = await getBomIngredientNeedsInTx(
    tx,
    orders.flatMap((order) =>
      order.manufacturableLines.filter(
        (line) => !linkedLineIdsByOrderId.get(order.id)?.has(line.salesOrderLineId)
      )
    )
  );
  const bomNeedsByOrderId = new Map<string, IngredientNeed[]>();
  for (const need of bomNeeds) {
    bomNeedsByOrderId.set(need.salesOrderId, [
      ...(bomNeedsByOrderId.get(need.salesOrderId) ?? []),
      need,
    ]);
  }

  const allIngredientItemIds = [
    ...new Set(
      [...linkedNeedsByOrderId.values(), ...bomNeedsByOrderId.values()]
        .flat()
        .map((need) => need.itemId)
    ),
  ];
  const ingredientSupplyByItemId = await getIngredientSupplyByItemIdInTx(
    tx,
    orgId,
    allIngredientItemIds
  );

  const orderSortLineByOrderId = new Map<string, SalesFulfillmentDemandLine>();
  for (const line of demandLines) {
    const existing = orderSortLineByOrderId.get(line.salesOrderId);
    if (!existing || compareAvailabilityLines(line, existing) < 0) {
      orderSortLineByOrderId.set(line.salesOrderId, line);
    }
  }

  const models = new Map<string, SalesFulfillmentReadModel>();
  for (const order of [...orders].sort((left, right) => {
    const leftLine = orderSortLineByOrderId.get(left.id);
    const rightLine = orderSortLineByOrderId.get(right.id);
    if (leftLine && rightLine) return compareAvailabilityLines(leftLine, rightLine);
    if (leftLine) return -1;
    if (rightLine) return 1;
    return left.id.localeCompare(right.id);
  })) {
    const availability = availabilityByOrderId.get(order.id);
    const salesItemsState = availability?.salesItemsState ?? "not_available";
    const productionState = deriveProductionState(order);

    if (salesItemsState === "available" || salesItemsState === "complete") {
      models.set(order.id, {
        salesItemsState,
        salesItemsExpectedDate: null,
        productionState,
        ingredientsState: "not_needed",
        ingredientsExpectedDate: null,
        ingredientShortages: [],
      });
      continue;
    }

    const linkedNeeds = aggregateNeeds(linkedNeedsByOrderId.get(order.id) ?? []);
    const bomOrderNeeds = bomNeedsByOrderId.get(order.id) ?? [];
    const ingredientNeeds = aggregateNeeds([...linkedNeeds, ...bomOrderNeeds]);
    const linkedLineIds = linkedLineIdsByOrderId.get(order.id);
    const hasUnlinkedManufacturableLines = order.manufacturableLines.some(
      (line) => !linkedLineIds?.has(line.salesOrderLineId)
    );

    const ingredientCoverage =
      !hasUnlinkedManufacturableLines &&
      order.linkedManufacturingOrders.length > 0 &&
      (order.linkedManufacturingOrders.every((mo) => mo.productionStatus === "done") ||
        linkedNeeds.length === 0)
        ? {
            summary: {
              ingredientsState: "picked" as const,
              ingredientsExpectedDate: null,
            },
            shortages: [],
          }
        : (() => {
            const coverage = coverageForNeeds(ingredientNeeds, ingredientSupplyByItemId);
            return {
              summary: rollupIngredientCoverages(coverage.coverages),
              shortages: coverage.shortages,
            };
          })();

    models.set(order.id, {
      salesItemsState,
      salesItemsExpectedDate:
        salesItemsState === "expected"
          ? availability?.salesItemsExpectedDate ?? null
          : null,
      productionState,
      ...ingredientCoverage.summary,
      ingredientShortages: ingredientCoverage.shortages,
    });
  }

  return models;
}
