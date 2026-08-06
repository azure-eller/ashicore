import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { calculateIngredientPlannedQuantity } from "@/lib/manufacturing/consumption";
import { getCurrentBomsByProductIdInTx } from "@/lib/bom/current-boms";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { parseQuantity, roundQuantity } from "@/lib/format";
import { compareDocumentNumbers } from "@/lib/document-number-format";
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
  availabilityStatus: "expected" | "missing";
  requiredQty: number;
  shortQty: number;
  availableQty: number;
  expectedQty: number;
  missingQty: number;
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

  const orderCompare = compareDocumentNumbers(
    left.orderNumber,
    right.orderNumber,
    "SO"
  );
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
        sql`COALESCE(SUM(GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived} - ${purchaseOrderLines.stockQuantityClosed}, 0)), 0)`
      ).as("quantity"),
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        inArray(purchaseOrders.status, ["not_received", "partial"]),
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
  const supplyByItem = new Map<string, AvailabilitySupplySlice[]>();
  const linkedManufacturingSupplyByLineId = new Map<string, AvailabilitySupplySlice[]>();
  const implicitManufacturingIngredientDemandByItemId = new Map<string, number>();
  for (const row of manufacturingIngredientDemandRows) {
    const quantity = roundQuantity(parseQuantity(row.quantity));
    if (quantity <= 0) continue;
    implicitManufacturingIngredientDemandByItemId.set(row.itemId, quantity);
  }

  for (const row of currentSupplyRows) {
    const quantity = roundQuantity(
      Number(row.quantity) -
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
    const quantity = roundQuantity(Number(row.quantity));
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
      linkedManufacturingSupplyByLineId.get(demand.salesOrderLineId) ?? [],
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

  if (order.hasManufacturableLines && order.shortQty > 0) {
    return "make";
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

  return "not_applicable";
}

function rollupIngredientCoverages(
  coverages: IngredientCoverage[]
): Pick<SalesFulfillmentReadModel, "ingredientsState" | "ingredientsExpectedDate"> {
  if (coverages.length === 0) {
    return { ingredientsState: "not_applicable", ingredientsExpectedDate: null };
  }

  const expectedDates = coverages
    .map((coverage) => coverage.expectedDate)
    .filter((date): date is string => date != null);

  if (coverages.some((coverage) => coverage.state === "not_available")) {
    return {
      ingredientsState: "not_available",
      ingredientsExpectedDate: expectedDates.sort().at(-1) ?? null,
    };
  }

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
    let expectedQty = 0;
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
    const availableQty = roundQuantity(need.quantity - currentShortQty);

    for (const supply of supplies.filter((slice) => slice.expectedDate != null)) {
      if (remaining <= 0) break;
      if (supply.quantity <= 0) continue;

      const consumed = Math.min(remaining, supply.quantity);
      supply.quantity = roundQuantity(supply.quantity - consumed);
      remaining = roundQuantity(remaining - consumed);
      expectedQty = roundQuantity(expectedQty + consumed);
      consumedExpected = true;
      expectedDate =
        [expectedDate, supply.expectedDate]
          .filter((date): date is string => date != null)
          .sort()
          .at(-1) ?? null;
    }

    if (currentShortQty > 0) {
      if (expectedQty > 0) {
        shortages.push({
          itemId: need.itemId,
          itemName: need.itemName,
          itemSku: need.itemSku,
          unitName: need.unitName,
          availabilityStatus: "expected",
          requiredQty: need.quantity,
          shortQty: expectedQty,
          availableQty,
          expectedQty,
          missingQty: 0,
        });
      }

      if (remaining > 0) {
        shortages.push({
          itemId: need.itemId,
          itemName: need.itemName,
          itemSku: need.itemSku,
          unitName: need.unitName,
          availabilityStatus: "missing",
          requiredQty: need.quantity,
          shortQty: remaining,
          availableQty,
          expectedQty: 0,
          missingQty: remaining,
        });
      }
    }

    if (remaining <= 0 && !consumedExpected) {
      coverages.push({ state: "in_stock", expectedDate: null });
      continue;
    }

    if (remaining <= 0) {
      coverages.push({ state: "expected", expectedDate });
      continue;
    }

    coverages.push({
      state: "not_available",
      expectedDate: expectedQty > 0 ? expectedDate : null,
    });
  }

  return { coverages, shortages };
}

function preclaimIngredientSupply(
  supplyByItemId: Map<string, IngredientSupplySlice[]>,
  claimsByItemId: Map<string, number>
) {
  for (const [itemId, claimQty] of claimsByItemId) {
    let remaining = claimQty;
    for (const supply of supplyByItemId.get(itemId) ?? []) {
      if (remaining <= 0) break;
      if (supply.quantity <= 0) continue;

      const consumed = Math.min(remaining, supply.quantity);
      supply.quantity = roundQuantity(supply.quantity - consumed);
      remaining = roundQuantity(remaining - consumed);
    }
  }
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
  const bomByProductId = await getCurrentBomsByProductIdInTx(tx, productIds);

  const needs: IngredientNeed[] = [];
  for (const line of activeLines) {
    const bom = bomByProductId.get(line.itemId);
    if (!bom) continue;

    const outputQuantity = parseQuantity(line.quantity);
    const recipeBasis = bom.recipeBasis;
    const recipeOutputQuantity = parseQuantity(bom.outputQuantity);
    const numberOfBatches =
      recipeBasis === "batch" && recipeOutputQuantity > 0
        ? Math.ceil(outputQuantity / recipeOutputQuantity)
        : null;

    for (const component of bom.components) {
      needs.push({
        salesOrderId: line.salesOrderId,
        itemId: component.componentId,
        itemName: component.componentName,
        itemSku: component.componentSku,
        unitName: component.unitName,
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
  itemIds: string[],
  options: { excludeManufacturingOrderIds?: string[] } = {}
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
        sql`COALESCE(SUM(GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived} - ${purchaseOrderLines.stockQuantityClosed}, 0)), 0)`
      ).as("quantity"),
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        inArray(purchaseOrders.status, ["not_received", "partial"]),
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
  const manufacturingDemandRows = await tx
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
        inArray(manufacturingOrderIngredients.itemId, uniqueItemIds),
        options.excludeManufacturingOrderIds &&
        options.excludeManufacturingOrderIds.length > 0
          ? sql`${manufacturingOrders.id} NOT IN (${sql.join(
              options.excludeManufacturingOrderIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          : undefined,
        sql`${manufacturingOrderIngredients.plannedQuantity} > ${manufacturingOrderIngredients.pickedQuantity}`
      )
    )
    .groupBy(manufacturingOrderIngredients.itemId);
  const manufacturingDemandByItemId = new Map(
    manufacturingDemandRows.map((row) => [row.itemId, parseQuantity(row.quantity)])
  );

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
  preclaimIngredientSupply(supplyByItemId, manufacturingDemandByItemId);

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
  const bomNeeds = await getBomIngredientNeedsInTx(
    tx,
    orders.flatMap((order) => order.manufacturableLines)
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
    allIngredientItemIds,
    {
      excludeManufacturingOrderIds: linkedOpenMoLinks.map(
        (link) => link.manufacturingOrderId
      ),
    }
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
    const bomOrderNeeds =
      salesItemsState === "expected" && order.shortQty <= 0
        ? []
        : (bomNeedsByOrderId.get(order.id) ?? []);
    const ingredientNeeds = aggregateNeeds([...linkedNeeds, ...bomOrderNeeds]);
    const hasUnlinkedManufacturableLines = order.manufacturableLines.some(
      (line) => line.status === "will_create" && parseQuantity(line.quantity) > 0
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
