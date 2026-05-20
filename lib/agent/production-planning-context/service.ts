import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  itemFamilies,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { type Tx, withOrgContext } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { buildPlanningSnapshotInTx } from "@/lib/planning/service";
import type { PlanningSnapshot } from "@/lib/planning/types";
import type {
  AgentAllocationContext,
  AgentAttentionQueueItem,
  AgentInventoryContext,
  AgentOpenManufacturingOrderContext,
  AgentOpenPurchaseOrderContext,
  AgentOpenSalesOrderContext,
  AgentProductionPlanningContext,
  AgentProductionPlanningContextOptions,
} from "./types";

const OPEN_SALES_ORDER_STATUSES = ["open"] as const;
const OPEN_PURCHASE_ORDER_STATUSES = ["ordered", "partial"] as const;

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function addDefined(set: Set<string>, value: string | null | undefined) {
  if (value) set.add(value);
}

async function getShippedSalesQuantityByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: trimScale(sql`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .where(
      and(
        inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds),
        eq(salesShipments.status, "shipped")
      )
    )
    .groupBy(salesShipmentLines.salesOrderLineId);

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

async function getPlannedSalesQuantityByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: trimScale(sql`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .where(
      and(
        inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds),
        eq(salesShipments.status, "planned")
      )
    )
    .groupBy(salesShipmentLines.salesOrderLineId);

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

async function getPlannedShipmentAllocationQuantityByLineInTx(
  tx: Tx,
  salesOrderLineIds: string[]
) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: trimScale(sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(stockAllocations)
    .innerJoin(
      salesShipmentLines,
      eq(stockAllocations.demandId, salesShipmentLines.id)
    )
    .where(
      and(
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(stockAllocations.status, "active"),
        inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds)
      )
    )
    .groupBy(salesShipmentLines.salesOrderLineId);

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

function demandAllocationKey(demandType: string, demandId: string) {
  return `${demandType}:${demandId}`;
}

function itemDisplayName(row: { name: string; familyName: string | null }) {
  return row.familyName ?? row.name;
}

async function loadActiveAllocationContextInTx(
  tx: Tx,
  organizationId: string
): Promise<AgentAllocationContext[]> {
  const lineRefs = alias(salesOrderLines, "agent_allocation_sales_order_lines");
  const lineOrderRefs = alias(salesOrders, "agent_allocation_sales_orders");
  const shipmentLineRefs = alias(
    salesShipmentLines,
    "agent_allocation_sales_shipment_lines"
  );
  const shipmentRefs = alias(salesShipments, "agent_allocation_sales_shipments");
  const shipmentOrderRefs = alias(
    salesOrders,
    "agent_allocation_sales_shipment_orders"
  );
  const ingredientRefs = alias(
    manufacturingOrderIngredients,
    "agent_allocation_mo_ingredients"
  );
  const ingredientOrderRefs = alias(
    manufacturingOrders,
    "agent_allocation_ingredient_orders"
  );
  const sourceManufacturingOrders = alias(
    manufacturingOrders,
    "agent_allocation_source_mos"
  );

  const rows = await tx
    .select({
      allocationId: stockAllocations.id,
      itemId: stockAllocations.itemId,
      itemName: items.name,
      familyName: itemFamilies.name,
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
      demandLabelSnapshot: stockAllocations.demandLabelSnapshot,
      sourceLabelSnapshot: stockAllocations.sourceLabelSnapshot,
      salesOrderNumber: lineOrderRefs.orderNumber,
      shipmentNumber: shipmentRefs.shipmentNumber,
      shipmentOrderNumber: shipmentOrderRefs.orderNumber,
      ingredientOrderNumber: ingredientOrderRefs.orderNumber,
      lotNumber: lots.lotNumber,
      sourceManufacturingOrderNumber: sourceManufacturingOrders.orderNumber,
    })
    .from(stockAllocations)
    .innerJoin(items, eq(stockAllocations.itemId, items.id))
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(
      lineRefs,
      and(
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.demandId, lineRefs.id)
      )
    )
    .leftJoin(lineOrderRefs, eq(lineRefs.salesOrderId, lineOrderRefs.id))
    .leftJoin(
      shipmentLineRefs,
      and(
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(stockAllocations.demandId, shipmentLineRefs.id)
      )
    )
    .leftJoin(
      shipmentRefs,
      eq(shipmentLineRefs.salesShipmentId, shipmentRefs.id)
    )
    .leftJoin(shipmentOrderRefs, eq(shipmentRefs.salesOrderId, shipmentOrderRefs.id))
    .leftJoin(
      ingredientRefs,
      and(
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        eq(stockAllocations.demandId, ingredientRefs.id)
      )
    )
    .leftJoin(
      ingredientOrderRefs,
      eq(ingredientRefs.manufacturingOrderId, ingredientOrderRefs.id)
    )
    .leftJoin(
      lots,
      and(
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.sourceId, lots.id)
      )
    )
    .leftJoin(
      sourceManufacturingOrders,
      and(
        eq(stockAllocations.sourceType, "manufacturing_order"),
        eq(stockAllocations.sourceId, sourceManufacturingOrders.id)
      )
    )
    .where(
      and(
        eq(stockAllocations.organizationId, organizationId),
        eq(stockAllocations.status, "active"),
        or(
          and(
            eq(stockAllocations.demandType, "sales_order_line"),
            inArray(lineOrderRefs.status, [...OPEN_SALES_ORDER_STATUSES]),
            isNull(lineOrderRefs.deletedAt)
          ),
          and(
            eq(stockAllocations.demandType, "sales_shipment_line"),
            eq(shipmentRefs.status, "planned"),
            inArray(shipmentOrderRefs.status, [...OPEN_SALES_ORDER_STATUSES]),
            isNull(shipmentOrderRefs.deletedAt)
          ),
          and(
            eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
            eq(ingredientOrderRefs.status, "open"),
            isNull(ingredientOrderRefs.deletedAt),
            isNull(ingredientOrderRefs.completedAt),
            isNull(ingredientOrderRefs.cancelledAt)
          )
        )
      )
    )
    .orderBy(asc(stockAllocations.createdAt), asc(stockAllocations.id));

  return rows
    .filter(
      (row): row is typeof row & {
        demandType: AgentAllocationContext["demandType"];
        sourceType: AgentAllocationContext["sourceType"];
      } =>
        (row.demandType === "sales_order_line" ||
          row.demandType === "sales_shipment_line" ||
          row.demandType === "manufacturing_order_ingredient") &&
        (row.sourceType === "inventory_lot" ||
          row.sourceType === "manufacturing_order")
    )
    .map((row) => ({
      allocationId: row.allocationId,
      itemId: row.itemId,
      itemName: itemDisplayName({ name: row.itemName, familyName: row.familyName }),
      demandType: row.demandType,
      demandId: row.demandId,
      demandLabel:
        row.demandLabelSnapshot ??
        row.salesOrderNumber ??
        row.shipmentNumber ??
        row.shipmentOrderNumber ??
        row.ingredientOrderNumber ??
        row.demandId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceLabel:
        row.sourceLabelSnapshot ??
        row.lotNumber ??
        row.sourceManufacturingOrderNumber ??
        row.sourceId,
      quantity: row.quantity,
      status: "active",
    }));
}

function sumAllocationsByDemand(allocations: AgentAllocationContext[]) {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const key = demandAllocationKey(allocation.demandType, allocation.demandId);
    totals.set(key, roundQuantity((totals.get(key) ?? 0) + toQuantity(allocation.quantity)));
  }
  return totals;
}

function productionStatusForSalesLine(args: {
  itemId: string;
  openQty: number;
  allocatedQty: number;
  snapshot: PlanningSnapshot;
}) {
  if (args.openQty > 0 && args.allocatedQty >= args.openQty) return "allocated";

  const hasBlocker = args.snapshot.productionBlockerFacts.some(
    (blocker) =>
      blocker.parentItemId === args.itemId || blocker.componentItemId === args.itemId
  );
  if (hasBlocker) return "blocked";

  const row = args.snapshot.rows.find((entry) => entry.item.id === args.itemId);
  if (row && toQuantity(row.shortageQuantity) <= 0) return "available";

  const hasMakeRecommendation = args.snapshot.recommendations.some(
    (recommendation) =>
      recommendation.itemId === args.itemId &&
      recommendation.recommendationType === "create_manufacturing_order"
  );
  if (hasMakeRecommendation) return "needs_make";

  return "unknown";
}

async function loadOpenSalesOrdersInTx(
  tx: Tx,
  allocations: AgentAllocationContext[],
  snapshot: PlanningSnapshot
): Promise<AgentOpenSalesOrderContext[]> {
  const rows = await tx
    .select({
      salesOrderId: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      status: salesOrders.status,
      priorityRank: salesOrders.priorityRank,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      lineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      unitName: salesOrderLines.unitName,
      orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
      cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
    })
    .from(salesOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(
      sql`${salesOrders.priorityRank} IS NULL`,
      asc(salesOrders.priorityRank),
      asc(salesOrders.shipDate),
      asc(salesOrders.requestedDate),
      asc(salesOrders.orderDate),
      asc(salesOrders.orderNumber),
      asc(salesOrderLines.sortOrder),
      asc(salesOrderLines.createdAt)
    );

  const lineIds = rows.map((row) => row.lineId);
  const shippedByLine = await getShippedSalesQuantityByLineInTx(tx, lineIds);
  const plannedByLine = await getPlannedSalesQuantityByLineInTx(tx, lineIds);
  const plannedShipmentAllocatedByLine =
    await getPlannedShipmentAllocationQuantityByLineInTx(tx, lineIds);
  const allocatedByDemand = sumAllocationsByDemand(allocations);
  const byOrder = new Map<string, AgentOpenSalesOrderContext>();

  for (const row of rows) {
    const orderedQty = toQuantity(row.orderedQty);
    const shippedQty = shippedByLine.get(row.lineId) ?? 0;
    const plannedShipmentQty = plannedByLine.get(row.lineId) ?? 0;
    const cancelledQty = toQuantity(row.cancelledQty);
    const openQty = roundQuantity(
      orderedQty - shippedQty - plannedShipmentQty - cancelledQty
    );
    if (openQty <= 0) continue;

    const directAllocatedQty =
      allocatedByDemand.get(demandAllocationKey("sales_order_line", row.lineId)) ?? 0;
    const shipmentAllocatedQty = plannedShipmentAllocatedByLine.get(row.lineId) ?? 0;
    const allocatedQty = roundQuantity(directAllocatedQty + shipmentAllocatedQty);
    const shortQty = roundQuantity(Math.max(0, openQty - allocatedQty));

    const order =
      byOrder.get(row.salesOrderId) ??
      ({
        salesOrderId: row.salesOrderId,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        status: row.status,
        orderDate: row.orderDate,
        requiredDate: row.shipDate ?? row.requestedDate,
        fulfillmentStatus: "open",
        priorityRank: row.priorityRank,
        lines: [],
      } satisfies AgentOpenSalesOrderContext);

    order.lines.push({
      salesOrderLineId: row.lineId,
      itemId: row.itemId,
      itemName: row.itemName,
      unitName: row.unitName,
      orderedQty: row.orderedQty,
      shippedQty: quantityString(shippedQty),
      plannedShipmentQty: quantityString(plannedShipmentQty),
      cancelledQty: row.cancelledQty,
      openQty: quantityString(openQty),
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(shortQty),
      productionStatus: productionStatusForSalesLine({
        itemId: row.itemId,
        openQty,
        allocatedQty,
        snapshot,
      }),
    });
    byOrder.set(row.salesOrderId, order);
  }

  return [...byOrder.values()].map((order) => {
    const hasShort = order.lines.some((line) => toQuantity(line.shortQty) > 0);
    const isAllocated = order.lines.every(
      (line) => toQuantity(line.allocatedQty) >= toQuantity(line.openQty)
    );
    return {
      ...order,
      fulfillmentStatus: isAllocated ? "allocated" : hasShort ? "short" : "open",
    };
  });
}

async function loadOpenManufacturingOrdersInTx(
  tx: Tx,
  allocations: AgentAllocationContext[]
): Promise<AgentOpenManufacturingOrderContext[]> {
  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      unitName: manufacturingOrders.unitName,
      plannedQty: trimScale(manufacturingOrders.plannedQuantity).as("plannedQty"),
      completedQty: trimScaleNullable(manufacturingOrders.actualQuantity).as("completedQty"),
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      ingredientId: manufacturingOrderIngredients.id,
      ingredientItemId: manufacturingOrderIngredients.itemId,
      ingredientItemName: manufacturingOrderIngredients.itemName,
      ingredientUnitName: manufacturingOrderIngredients.unitName,
      requiredQty: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "requiredQty"
      ),
      pickedQty: trimScale(manufacturingOrderIngredients.pickedQuantity).as("pickedQty"),
      ingredientSortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrders)
    .leftJoin(
      manufacturingOrderIngredients,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    )
    .orderBy(
      sql`${manufacturingOrders.priorityRank} IS NULL`,
      asc(manufacturingOrders.priorityRank),
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder)
    );

  const allocatedByDemand = sumAllocationsByDemand(allocations);
  const outputAllocationsBySource = new Map<string, AgentOpenManufacturingOrderContext["outputAllocations"]>();
  for (const allocation of allocations) {
    if (allocation.sourceType !== "manufacturing_order") continue;
    const bucket = outputAllocationsBySource.get(allocation.sourceId) ?? [];
    bucket.push({
      allocationId: allocation.allocationId,
      demandType: allocation.demandType,
      demandId: allocation.demandId,
      demandLabel: allocation.demandLabel,
      quantity: allocation.quantity,
    });
    outputAllocationsBySource.set(allocation.sourceId, bucket);
  }

  const byOrder = new Map<string, AgentOpenManufacturingOrderContext>();
  for (const row of rows) {
    const completedQty = toQuantity(row.completedQty);
    const plannedQty = toQuantity(row.plannedQty);
    const order =
      byOrder.get(row.manufacturingOrderId) ??
      ({
        manufacturingOrderId: row.manufacturingOrderId,
        orderNumber: row.orderNumber,
        status: row.status,
        itemId: row.productId,
        itemName: row.productName,
        unitName: row.unitName,
        plannedQty: row.plannedQty,
        completedQty: quantityString(completedQty),
        remainingQty: quantityString(Math.max(0, plannedQty - completedQty)),
        plannedDate: row.plannedDate,
        expectedOutputDate: row.plannedDate,
        priorityRank: row.priorityRank,
        salesOrderId: row.salesOrderId,
        salesOrderLineId: row.salesOrderLineId,
        outputAllocations:
          outputAllocationsBySource.get(row.manufacturingOrderId) ?? [],
        ingredients: [],
      } satisfies AgentOpenManufacturingOrderContext);

    if (row.ingredientId) {
      const allocatedQty =
        allocatedByDemand.get(
          demandAllocationKey("manufacturing_order_ingredient", row.ingredientId)
        ) ?? 0;
      const requiredQty = toQuantity(row.requiredQty);
      const pickedQty = toQuantity(row.pickedQty);
      const unpickedRequiredQty = Math.max(0, roundQuantity(requiredQty - pickedQty));
      order.ingredients.push({
        manufacturingOrderIngredientId: row.ingredientId,
        itemId: row.ingredientItemId ?? "",
        itemName: row.ingredientItemName ?? "",
        unitName: row.ingredientUnitName,
        requiredQty: row.requiredQty ?? "0",
        pickedQty: row.pickedQty ?? "0",
        allocatedQty: quantityString(allocatedQty),
        shortQty: quantityString(Math.max(0, unpickedRequiredQty - allocatedQty)),
      });
    }

    byOrder.set(row.manufacturingOrderId, order);
  }

  return [...byOrder.values()];
}

async function loadOpenPurchaseOrdersInTx(
  tx: Tx
): Promise<AgentOpenPurchaseOrderContext[]> {
  const rows = await tx
    .select({
      purchaseOrderId: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      status: purchaseOrders.status,
      expectedDate: purchaseOrders.expectedDate,
      lineId: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      orderedQty: trimScale(purchaseOrderLines.stockQuantityOrdered).as("orderedQty"),
      receivedQty: trimScale(purchaseOrderLines.stockQuantityReceived).as("receivedQty"),
      sortOrder: purchaseOrderLines.sortOrder,
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrders.status, [...OPEN_PURCHASE_ORDER_STATUSES]),
        isNull(purchaseOrders.deletedAt)
      )
    )
    .orderBy(
      asc(purchaseOrders.expectedDate),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder)
    );

  const byOrder = new Map<string, AgentOpenPurchaseOrderContext>();
  for (const row of rows) {
    const remainingQty = roundQuantity(
      toQuantity(row.orderedQty) - toQuantity(row.receivedQty)
    );
    if (remainingQty <= 0) continue;

    const order =
      byOrder.get(row.purchaseOrderId) ??
      ({
        purchaseOrderId: row.purchaseOrderId,
        orderNumber: row.orderNumber,
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        status: row.status,
        expectedDate: row.expectedDate,
        lines: [],
      } satisfies AgentOpenPurchaseOrderContext);

    order.lines.push({
      purchaseOrderLineId: row.lineId,
      itemId: row.itemId,
      itemName: row.itemName,
      stockingUnitName: row.stockingUnitName,
      orderedQty: row.orderedQty,
      receivedQty: row.receivedQty,
      remainingQty: quantityString(remainingQty),
    });
    byOrder.set(row.purchaseOrderId, order);
  }

  return [...byOrder.values()];
}

function collectRelevantItemIds(args: {
  snapshot: PlanningSnapshot;
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  purchaseOrders: AgentOpenPurchaseOrderContext[];
  allocations: AgentAllocationContext[];
}) {
  const itemIds = new Set<string>();
  for (const row of args.snapshot.rows) addDefined(itemIds, row.item.id);
  for (const fact of args.snapshot.demandFacts) {
    addDefined(itemIds, fact.itemId);
    addDefined(itemIds, fact.parentItemId);
  }
  for (const fact of args.snapshot.supplyFacts) addDefined(itemIds, fact.itemId);
  for (const fact of args.snapshot.inventoryFacts) addDefined(itemIds, fact.itemId);
  for (const fact of args.snapshot.bomRequirementFacts) {
    addDefined(itemIds, fact.parentItemId);
    addDefined(itemIds, fact.componentItemId);
  }
  for (const path of args.snapshot.salesOrderProductionDemandPaths) {
    addDefined(itemIds, path.itemId);
    addDefined(itemIds, path.terminal.itemId);
    for (const step of path.steps) addDefined(itemIds, step.itemId);
  }
  for (const order of args.salesOrders) {
    for (const line of order.lines) addDefined(itemIds, line.itemId);
  }
  for (const order of args.manufacturingOrders) {
    addDefined(itemIds, order.itemId);
    for (const ingredient of order.ingredients) addDefined(itemIds, ingredient.itemId);
  }
  for (const order of args.purchaseOrders) {
    for (const line of order.lines) addDefined(itemIds, line.itemId);
  }
  for (const allocation of args.allocations) addDefined(itemIds, allocation.itemId);
  return [...itemIds].sort();
}

async function loadRelevantInventoryContextInTx(
  tx: Tx,
  params: {
    itemIds: string[];
    snapshot: PlanningSnapshot;
    allocations: AgentAllocationContext[];
    includeLots: boolean;
  }
): Promise<AgentInventoryContext[]> {
  if (params.itemIds.length === 0) return [];

  const itemRows = await tx
    .select({
      itemId: items.id,
      name: items.name,
      familyName: itemFamilies.name,
      unitName: unitDefinitions.name,
      onHandQty: trimScale(sql`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`).as(
        "onHandQty"
      ),
      reservedQty: trimScale(
        sql`COALESCE(SUM(${inventoryItemBalances.committedQty}), 0)`
      ).as("reservedQty"),
      expectedQty: trimScale(
        sql`COALESCE(SUM(${inventoryItemBalances.expectedQty}), 0)`
      ).as("expectedQty"),
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(inventoryItemBalances, eq(inventoryItemBalances.itemId, items.id))
    .where(inArray(items.id, params.itemIds))
    .groupBy(items.id, items.name, itemFamilies.name, unitDefinitions.name)
    .orderBy(asc(itemFamilies.name), asc(items.name), asc(items.id));

  const planningRowsByItemId = new Map(
    params.snapshot.rows.map((row) => [row.item.id, row])
  );
  const inventoryFactsByItemId = new Map(
    params.snapshot.inventoryFacts.map((fact) => [fact.itemId, fact])
  );
  const inventoryLotAllocatedByItem = new Map<string, number>();
  const manufacturingOutputAllocatedByItem = new Map<string, number>();
  const allocatedByLot = new Map<string, number>();
  for (const allocation of params.allocations) {
    if (allocation.sourceType === "inventory_lot") {
      inventoryLotAllocatedByItem.set(
        allocation.itemId,
        roundQuantity(
          (inventoryLotAllocatedByItem.get(allocation.itemId) ?? 0) +
            toQuantity(allocation.quantity)
        )
      );
      allocatedByLot.set(
        allocation.sourceId,
        roundQuantity((allocatedByLot.get(allocation.sourceId) ?? 0) + toQuantity(allocation.quantity))
      );
    } else if (allocation.sourceType === "manufacturing_order") {
      manufacturingOutputAllocatedByItem.set(
        allocation.itemId,
        roundQuantity(
          (manufacturingOutputAllocatedByItem.get(allocation.itemId) ?? 0) +
            toQuantity(allocation.quantity)
        )
      );
    }
  }

  const lotRows = params.includeLots
    ? await tx
        .select({
          itemId: inventoryLotBalances.itemId,
          lotId: inventoryLotBalances.lotId,
          lotNumber: lots.lotNumber,
          locationId: inventoryLotBalances.locationId,
          locationName: inventoryLocations.name,
          receivedAt: inventoryLotBalances.receivedAt,
          disposition: inventoryLotBalances.disposition,
          quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
            "quantity"
          ),
        })
        .from(inventoryLotBalances)
        .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
        .leftJoin(
          inventoryLocations,
          eq(inventoryLotBalances.locationId, inventoryLocations.id)
        )
        .where(
          and(
            inArray(inventoryLotBalances.itemId, params.itemIds),
            sql`${inventoryLotBalances.quantity} <> 0`
          )
        )
        .groupBy(
          inventoryLotBalances.itemId,
          inventoryLotBalances.lotId,
          lots.lotNumber,
          inventoryLotBalances.locationId,
          inventoryLocations.name,
          inventoryLotBalances.receivedAt,
          inventoryLotBalances.disposition
        )
        .orderBy(
          asc(inventoryLotBalances.itemId),
          asc(inventoryLotBalances.receivedAt),
          asc(lots.lotNumber),
          asc(inventoryLotBalances.disposition)
        )
    : [];

  const lotsByItemId = new Map<string, AgentInventoryContext["lots"]>();
  for (const row of lotRows) {
    const allocatedQty =
      row.disposition === "available" ? allocatedByLot.get(row.lotId) ?? 0 : 0;
    const quantity = toQuantity(row.quantity);
    const bucket = lotsByItemId.get(row.itemId) ?? [];
    bucket.push({
      lotId: row.lotId,
      lotCode: row.lotNumber,
      locationId: row.locationId,
      locationName: row.locationName,
      receivedDate: row.receivedAt.toISOString(),
      disposition: row.disposition,
      onHandQty: row.quantity,
      availableQty:
        row.disposition === "available"
          ? quantityString(Math.max(0, quantity - allocatedQty))
          : "0",
      allocatedQty: quantityString(allocatedQty),
    });
    lotsByItemId.set(row.itemId, bucket);
  }

  return itemRows.map((row) => {
    const planningRow = planningRowsByItemId.get(row.itemId);
    const inventoryFact = inventoryFactsByItemId.get(row.itemId);
    const onHandQty = inventoryFact?.onHandQuantity ?? row.onHandQty;
    const reservedQty = inventoryFact?.reservedQuantity ?? row.reservedQty;
    const expectedQty = inventoryFact?.expectedQuantity ?? row.expectedQty;
    const inventoryLotAllocatedQty = inventoryLotAllocatedByItem.get(row.itemId) ?? 0;
    const manufacturingOutputAllocatedQty =
      manufacturingOutputAllocatedByItem.get(row.itemId) ?? 0;
    return {
      itemId: row.itemId,
      itemName: itemDisplayName(row),
      unitName: row.unitName,
      onHandQty,
      availableQty:
        inventoryFact?.availableQuantity ??
        quantityString(toQuantity(onHandQty) - toQuantity(reservedQty)),
      reservedQty,
      expectedQty,
      projectedQty: planningRow?.projectedQuantity ?? quantityString(toQuantity(onHandQty)),
      inventoryLotAllocatedQty: quantityString(inventoryLotAllocatedQty),
      manufacturingOutputAllocatedQty: quantityString(manufacturingOutputAllocatedQty),
      totalActiveAllocationQty: quantityString(
        inventoryLotAllocatedQty + manufacturingOutputAllocatedQty
      ),
      lots: lotsByItemId.get(row.itemId) ?? [],
    };
  });
}

function buildAttentionQueue(snapshot: PlanningSnapshot): AgentAttentionQueueItem[] {
  const blockerItems: AgentAttentionQueueItem[] = snapshot.productionBlockerFacts.map(
    (blocker) => ({
      type:
        blocker.blockerType === "missing_bom"
          ? "missing_bom"
          : blocker.blockerType === "material_shortage"
            ? "material_shortage"
            : "production_needed",
      severity:
        blocker.blockerType === "missing_bom" ||
        blocker.blockerType === "material_shortage"
          ? "urgent"
          : "warning",
      label:
        blocker.componentItemName && blocker.shortageQuantity
          ? `${blocker.parentItemName} is blocked by ${blocker.shortageQuantity} ${blocker.componentUnitName ?? ""} ${blocker.componentItemName}`.trim()
          : `${blocker.parentItemName} has a production blocker: ${blocker.blockerType}`,
      sourceRefs: blocker.sourceRefs,
    })
  );

  const recommendationItems: AgentAttentionQueueItem[] = snapshot.recommendations
    .filter((recommendation) => recommendation.recommendationType !== "none")
    .map((recommendation) => ({
      type:
        recommendation.recommendationType === "create_manufacturing_order"
          ? "production_needed"
          : recommendation.recommendationType === "create_purchase_order"
            ? "purchase_needed"
            : "planning_warning",
      severity:
        recommendation.recommendationType === "review_item_setup"
          ? "warning"
          : "info",
      label: recommendation.explanation,
      sourceRefs: recommendation.sourceRefs,
    }));

  const warningItems: AgentAttentionQueueItem[] = snapshot.warnings.map((warning) => ({
    type: "planning_warning",
    severity: warning.severity === "error" ? "urgent" : warning.severity,
    label: warning.message,
    sourceRefs: warning.sourceRefs,
  }));

  return [...blockerItems, ...recommendationItems, ...warningItems];
}

async function buildAgentProductionPlanningContextInTx(
  tx: Tx,
  orgId: string,
  options: Required<AgentProductionPlanningContextOptions>
): Promise<AgentProductionPlanningContext> {
  const snapshot = await buildPlanningSnapshotInTx(tx, orgId);
  const allocations = await loadActiveAllocationContextInTx(tx, orgId);
  const salesOrders = await loadOpenSalesOrdersInTx(tx, allocations, snapshot);
  const manufacturingOrders = await loadOpenManufacturingOrdersInTx(tx, allocations);
  const purchaseOrders = await loadOpenPurchaseOrdersInTx(tx);
  const relevantItemIds = collectRelevantItemIds({
    snapshot,
    salesOrders,
    manufacturingOrders,
    purchaseOrders,
    allocations,
  });
  const inventory = await loadRelevantInventoryContextInTx(tx, {
    itemIds: relevantItemIds,
    snapshot,
    allocations,
    includeLots: options.includeLots,
  });

  return {
    orgId: snapshot.orgId,
    generatedAt: snapshot.generatedAt,
    inputHash: snapshot.inputHash,
    summary: {
      openSalesOrderCount: salesOrders.length,
      openSalesOrderLineCount: salesOrders.reduce(
        (sum, order) => sum + order.lines.length,
        0
      ),
      openManufacturingOrderCount: manufacturingOrders.length,
      openPurchaseOrderCount: purchaseOrders.length,
      relevantItemCount: relevantItemIds.length,
      activeAllocationCount: allocations.length,
      recommendationCount: snapshot.recommendations.filter(
        (recommendation) => recommendation.recommendationType !== "none"
      ).length,
      productionBlockerCount: snapshot.productionBlockerFacts.length,
    },
    attentionQueue: buildAttentionQueue(snapshot),
    salesOrders,
    manufacturingOrders,
    purchaseOrders,
    inventory,
    allocations,
    planning: {
      horizonStart: snapshot.horizonStart,
      horizonEnd: snapshot.horizonEnd,
      assumptions: snapshot.assumptions,
      inputHash: snapshot.inputHash,
      rows: snapshot.rows,
      recommendations: snapshot.recommendations,
      productionBlockers: snapshot.productionBlockerFacts,
      demandFacts: options.includePlanningFacts ? snapshot.demandFacts : [],
      supplyFacts: options.includePlanningFacts ? snapshot.supplyFacts : [],
      inventoryFacts: options.includePlanningFacts ? snapshot.inventoryFacts : [],
      bomRequirements: options.includePlanningFacts
        ? snapshot.bomRequirementFacts
        : [],
      salesOrderProductionDemandPaths: snapshot.salesOrderProductionDemandPaths,
      warnings: snapshot.warnings,
    },
    allowedNextActions: [
      {
        action: "read_production_planning_context",
        status: "allowed",
        description:
          "This endpoint is read-only. Use the ERP UI for manufacturing orders, purchase orders, and allocations.",
      },
    ],
  };
}

export async function getAgentProductionPlanningContext(
  options: AgentProductionPlanningContextOptions = {}
) {
  const resolvedOptions = {
    includePlanningFacts: options.includePlanningFacts ?? true,
    includeLots: options.includeLots ?? true,
  };

  return withAuthedOrgContext((tx, orgId) =>
    buildAgentProductionPlanningContextInTx(tx, orgId, resolvedOptions)
  );
}

export async function getAgentProductionPlanningContextForOrg(
  orgId: string,
  options: AgentProductionPlanningContextOptions = {}
) {
  const resolvedOptions = {
    includePlanningFacts: options.includePlanningFacts ?? true,
    includeLots: options.includeLots ?? true,
  };

  return withOrgContext(orgId, (tx) =>
    buildAgentProductionPlanningContextInTx(tx, orgId, resolvedOptions)
  );
}
