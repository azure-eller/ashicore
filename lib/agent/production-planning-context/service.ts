import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  itemFamilies,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  organization,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { type Tx, withOrgContext } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { normalizeNumeric, roundQuantity, todayInTimeZone } from "@/lib/format";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "@/lib/inventory/allocation/format";
import { getItemDisplayMetadataByIdInTx } from "@/lib/inventory/item-display";
import { calculateIngredientPlannedQuantity, normalizeRecipeBasis } from "@/lib/manufacturing/consumption";
import { buildPlanningSnapshotInTx } from "@/lib/planning/service";
import type { PlanningSnapshot } from "@/lib/planning/types";
import type {
  AgentAttentionQueueItem,
  AgentCoverageNeedContext,
  AgentDecisionSupportContext,
  AgentDecisionQueueItem,
  AgentInventoryContext,
  AgentPlanningWarning,
  AgentOpenManufacturingOrderContext,
  AgentOpenPurchaseOrderContext,
  AgentOpenSalesOrderContext,
  AgentPlanningItemRow,
  AgentPlanningRecommendation,
  AgentProductionBlockerFact,
  AgentProductionPlanningContext,
  AgentProductionPlanningContextOptions,
  AgentProductionRawContext,
  AgentSupplyRecommendationContext,
  AgentBomRequirementContext,
  AgentTopLevelBomContext,
} from "./types";

const OPEN_SALES_ORDER_STATUSES = ["open"] as const;
const OPEN_PURCHASE_ORDER_STATUSES = ["not_received", "partial"] as const;
const MAX_AGENT_SOURCE_REFS = 24;
const MAX_MARKDOWN_SALES_DEMAND = 30;
const MAX_MARKDOWN_BUILD_TODAY = 30;
const MAX_MARKDOWN_UPCOMING_BUILDS = 30;
const MAX_MARKDOWN_OPEN_MOS = 20;
const MAX_MARKDOWN_TOP_LEVEL_BOMS = 90;
const DEFAULT_AGENT_CONTEXT_TIME_ZONE = "America/Denver";

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

async function loadOrganizationTodayInTx(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? DEFAULT_AGENT_CONTEXT_TIME_ZONE);
}

function line(text = "") {
  return text;
}

function mdCell(value: string | number | null | undefined) {
  return String(value ?? "-").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function compactQty(quantity: string | null | undefined, unitName: string | null) {
  const qty = quantity && quantity !== "0" ? quantity : null;
  if (!qty) return "-";
  return `${qty}${unitName ? ` ${unitName}` : ""}`;
}

function compactDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function subtractDays(value: string | null | undefined, days: number) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function earliestDate(
  left: string | null | undefined,
  right: string | null | undefined
) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left <= right ? left : right;
}

function addDefined(set: Set<string>, value: string | null | undefined) {
  if (value) set.add(value);
}

function sourceRef(args: {
  sourceType: AgentCoverageNeedContext["demandType"];
  sourceId: string;
  label: string;
  itemId: string;
  quantity: string;
  date: string | null;
  parentSourceId?: string | null;
}) {
  return {
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    label: args.label,
    itemId: args.itemId,
    quantity: args.quantity,
    date: args.date,
    parentSourceId: args.parentSourceId ?? null,
  };
}

function sanitizeSourceRefs(sourceRefs: PlanningSnapshot["warnings"][number]["sourceRefs"]) {
  const seen = new Set<string>();
  const sanitized = [];

  for (const ref of sourceRefs) {
    if (ref.sourceType === "bom_revision") continue;

    const key = [
      ref.sourceType,
      ref.sourceId,
      ref.itemId ?? "",
      ref.quantity ?? "",
      ref.date ?? "",
    ].join(":");
    if (seen.has(key)) continue;

    sanitized.push(ref);
    seen.add(key);
    if (sanitized.length >= MAX_AGENT_SOURCE_REFS) break;
  }

  return sanitized;
}

async function getShippedSalesQuantityByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      quantity: trimScale(salesOrderLines.shippedQuantity).as("quantity"),
    })
    .from(salesOrderLines)
    .where(inArray(salesOrderLines.id, salesOrderLineIds));

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

function productionStatusForSalesLine(args: {
  itemId: string;
  openQty: number;
  snapshot: PlanningSnapshot;
}) {
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
      asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
      asc(salesOrders.orderNumber),
      asc(salesOrderLines.sortOrder),
      asc(salesOrderLines.createdAt)
    );

  const lineIds = rows.map((row) => row.lineId);
  const shippedByLine = await getShippedSalesQuantityByLineInTx(tx, lineIds);
  const byOrder = new Map<string, AgentOpenSalesOrderContext>();

  for (const row of rows) {
    const orderedQty = toQuantity(row.orderedQty);
    const shippedQty = shippedByLine.get(row.lineId) ?? 0;
    const cancelledQty = toQuantity(row.cancelledQty);
    const openQty = roundQuantity(orderedQty - shippedQty - cancelledQty);
    if (openQty <= 0) continue;

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
      cancelledQty: row.cancelledQty,
      openQty: quantityString(openQty),
      coveredQty: "0",
      shortQty: quantityString(openQty),
      productionStatus: productionStatusForSalesLine({
        itemId: row.itemId,
        openQty,
        snapshot,
      }),
    });
    byOrder.set(row.salesOrderId, order);
  }

  return [...byOrder.values()].map((order) => {
    const hasShort = order.lines.some((line) => toQuantity(line.shortQty) > 0);
    return {
      ...order,
      fulfillmentStatus: hasShort ? "short" : "open",
    };
  });
}

async function loadOpenManufacturingOrdersInTx(
  tx: Tx
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
      asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder)
    );

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
        ingredients: [],
      } satisfies AgentOpenManufacturingOrderContext);

    if (row.ingredientId) {
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
        shortQty: quantityString(unpickedRequiredQty),
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
      asc(documentNumberSortSql(purchaseOrders.orderNumber, "PO")),
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

async function loadTopLevelBomContextInTx(
  tx: Tx,
  salesOrders: AgentOpenSalesOrderContext[],
  manufacturingOrders: AgentOpenManufacturingOrderContext[]
): Promise<AgentTopLevelBomContext[]> {
  const productsById = new Map<string, { productName: string; unitName: string | null }>();
  for (const order of salesOrders) {
    for (const line of order.lines) {
      productsById.set(line.itemId, {
        productName: line.itemName,
        unitName: line.unitName,
      });
    }
  }
  for (const order of manufacturingOrders) {
    productsById.set(order.itemId, {
      productName: order.itemName,
      unitName: order.unitName,
    });
  }

  const productIds = [...productsById.keys()];
  if (productIds.length === 0) return [];

  const revisionRows = await tx
    .select({
      revisionId: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      recipeBasis: bomRevisions.recipeBasis,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
    })
    .from(bomRevisions)
    .where(and(inArray(bomRevisions.productId, productIds), eq(bomRevisions.isCurrent, true)))
    .orderBy(asc(bomRevisions.productId), asc(bomRevisions.revisionNumber));

  if (revisionRows.length === 0) return [];

  const componentRows = await tx
    .select({
      bomRevisionComponentId: bomRevisionComponents.id,
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentItemId: bomRevisionComponents.componentId,
      componentName: bomRevisionComponents.componentName,
      componentItemType: bomRevisionComponents.componentItemType,
      unitName: bomRevisionComponents.unitName,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
      sortOrder: bomRevisionComponents.sortOrder,
      createdAt: bomRevisionComponents.createdAt,
    })
    .from(bomRevisionComponents)
    .where(
      inArray(
        bomRevisionComponents.bomRevisionId,
        revisionRows.map((revision) => revision.revisionId)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.bomRevisionId),
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );

  const constraintRows =
    componentRows.length === 0
      ? []
      : await tx
          .select({
            bomRevisionComponentId:
              bomRevisionComponentConstraints.bomRevisionComponentId,
            constraintType: bomRevisionComponentConstraints.constraintType,
            config: bomRevisionComponentConstraints.config,
            sortOrder: bomRevisionComponentConstraints.sortOrder,
          })
          .from(bomRevisionComponentConstraints)
          .where(
            inArray(
              bomRevisionComponentConstraints.bomRevisionComponentId,
              componentRows.map((component) => component.bomRevisionComponentId)
            )
          )
          .orderBy(
            asc(bomRevisionComponentConstraints.bomRevisionComponentId),
            asc(bomRevisionComponentConstraints.sortOrder)
          );

  const constraintsByComponentId = new Map<
    string,
    Array<{ type: string; label: string; minimumLotAgeDays: number | null }>
  >();
  for (const constraint of constraintRows) {
    const days =
      constraint.constraintType === "lot_age_min_days"
        ? Number(constraint.config?.days)
        : NaN;
    const minimumLotAgeDays = Number.isFinite(days) ? days : null;
    const label =
      minimumLotAgeDays == null
        ? constraint.constraintType
        : `must be at least ${minimumLotAgeDays} days old`;
    const bucket = constraintsByComponentId.get(constraint.bomRevisionComponentId) ?? [];
    bucket.push({
      type: constraint.constraintType,
      label,
      minimumLotAgeDays,
    });
    constraintsByComponentId.set(constraint.bomRevisionComponentId, bucket);
  }

  const componentsByRevisionId = new Map<string, AgentTopLevelBomContext["components"]>();
  for (const component of componentRows) {
    const constraints = constraintsByComponentId.get(component.bomRevisionComponentId) ?? [];
    const bucket = componentsByRevisionId.get(component.bomRevisionId) ?? [];
    bucket.push({
      bomRevisionComponentId: component.bomRevisionComponentId,
      componentItemId: component.componentItemId,
      componentName: component.componentName,
      componentItemType: component.componentItemType,
      unitName: component.unitName,
      quantity: component.quantity,
      minimumLotAgeDays:
        constraints.find((constraint) => constraint.minimumLotAgeDays != null)
          ?.minimumLotAgeDays ?? null,
      constraints,
    });
    componentsByRevisionId.set(component.bomRevisionId, bucket);
  }

  return revisionRows
    .map((revision) => {
      const product = productsById.get(revision.productId);
      if (!product) return null;
      return {
        productItemId: revision.productId,
        productName: product.productName,
        unitName: product.unitName,
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        recipeBasis: normalizeRecipeBasis(revision.recipeBasis),
        outputQuantity: revision.outputQuantity,
        components: componentsByRevisionId.get(revision.revisionId) ?? [],
      } satisfies AgentTopLevelBomContext;
    })
    .filter((bom): bom is AgentTopLevelBomContext => bom != null);
}

function collectRelevantItemIds(args: {
  snapshot: PlanningSnapshot;
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  purchaseOrders: AgentOpenPurchaseOrderContext[];
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
  return [...itemIds].sort();
}

async function loadRelevantInventoryContextInTx(
  tx: Tx,
  params: {
    itemIds: string[];
    snapshot: PlanningSnapshot;
    includeLots: boolean;
  }
): Promise<AgentInventoryContext[]> {
  if (params.itemIds.length === 0) return [];

  const itemRows = await tx
    .select({
      itemId: items.id,
      name: items.name,
      familyName: itemFamilies.name,
      lotTrackingMode: itemFamilies.lotTrackingMode,
      itemType: items.itemType,
      sellable: items.sellable,
      unitName: unitDefinitions.name,
      onHandQty: trimScale(sql`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`).as(
        "onHandQty"
      ),
      expectedQty: trimScale(
        sql`COALESCE(SUM(${inventoryItemBalances.expectedQty}), 0)`
      ).as("expectedQty"),
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(inventoryItemBalances, eq(inventoryItemBalances.itemId, items.id))
    .where(
      and(
        inArray(items.id, params.itemIds),
        eq(items.itemType, "product"),
        eq(items.sellable, true)
      )
    )
    .groupBy(
      items.id,
      items.name,
      itemFamilies.name,
      itemFamilies.lotTrackingMode,
      items.itemType,
      items.sellable,
      unitDefinitions.name
    )
    .orderBy(asc(itemFamilies.name), asc(items.name), asc(items.id));

  const displayByItemId = await getItemDisplayMetadataByIdInTx(
    tx,
    itemRows.map((row) => row.itemId)
  );
  const planningRowsByItemId = new Map(
    params.snapshot.rows.map((row) => [row.item.id, row])
  );
  const inventoryFactsByItemId = new Map(
    params.snapshot.inventoryFacts.map((fact) => [fact.itemId, fact])
  );
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

  const lotTrackedItemIds = new Set(
    itemRows
      .filter((row) => row.lotTrackingMode !== "untracked")
      .map((row) => row.itemId)
  );
  const lotsByItemId = new Map<string, AgentInventoryContext["lots"]>();
  for (const row of lotRows) {
    if (!lotTrackedItemIds.has(row.itemId)) continue;
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
          ? quantityString(quantity)
          : "0",
    });
    lotsByItemId.set(row.itemId, bucket);
  }

  return itemRows.map((row) => {
    const planningRow = planningRowsByItemId.get(row.itemId);
    const inventoryFact = inventoryFactsByItemId.get(row.itemId);
    const onHandQty = inventoryFact?.onHandQuantity ?? row.onHandQty;
    const expectedQty = inventoryFact?.expectedQuantity ?? row.expectedQty;
    return {
      itemId: row.itemId,
      itemName:
        displayByItemId.get(row.itemId)?.displayName ??
        row.familyName ??
        row.name,
      lotTrackingMode: row.lotTrackingMode === "untracked" ? "untracked" : "tracked",
      unitName: row.unitName,
      onHandQty,
      availableQty:
        inventoryFact?.availableQuantity ??
        quantityString(toQuantity(onHandQty)),
      expectedQty,
      projectedQty: planningRow?.projectedQuantity ?? quantityString(toQuantity(onHandQty)),
      lots: lotsByItemId.get(row.itemId) ?? [],
    };
  });
}

function sanitizePlanningRow(row: PlanningSnapshot["rows"][number]): AgentPlanningItemRow {
  const safeRow = { ...row };
  delete (safeRow as Partial<PlanningSnapshot["rows"][number]>).unitCost;
  delete (safeRow as Partial<PlanningSnapshot["rows"][number]>).unitCostSource;
  return safeRow;
}

function sanitizeRecommendation(
  recommendation: PlanningSnapshot["recommendations"][number]
): AgentPlanningRecommendation {
  const safeRecommendation = {
    ...recommendation,
    sourceRefs: sanitizeSourceRefs(recommendation.sourceRefs),
    warnings: recommendation.warnings.map(sanitizeWarning),
  };
  delete (safeRecommendation as Partial<PlanningSnapshot["recommendations"][number]>)
    .actionPayload;
  return safeRecommendation;
}

function sanitizeWarning(warning: PlanningSnapshot["warnings"][number]): AgentPlanningWarning {
  return {
    ...warning,
    sourceRefs: sanitizeSourceRefs(warning.sourceRefs),
  };
}

function sanitizeProductionBlocker(
  blocker: PlanningSnapshot["productionBlockerFacts"][number]
): AgentProductionBlockerFact {
  return {
    ...blocker,
    sourceRefs: sanitizeSourceRefs(blocker.sourceRefs),
  };
}

function sanitizeBomRequirement(
  requirement: PlanningSnapshot["bomRequirementFacts"][number]
): AgentBomRequirementContext {
  const safeRequirement = {
    ...requirement,
    sourceRefs: sanitizeSourceRefs(requirement.sourceRefs),
  };
  delete (safeRequirement as Partial<PlanningSnapshot["bomRequirementFacts"][number]>)
    .quantityPerParent;
  return safeRequirement;
}

function coverageReadiness(args: {
  shortQty: number;
  availableQty: number;
  projectedQty: number;
  planningRow: PlanningSnapshot["rows"][number] | undefined;
}) {
  if (args.availableQty >= args.shortQty) return "covered_by_available_inventory";
  if (args.projectedQty >= args.shortQty) return "available_after_open_supply";
  if (args.planningRow?.suggestedAction === "buy" || args.planningRow?.suggestedAction === "make") {
    return "create_supply";
  }
  if (
    args.planningRow?.reasonCodes.includes("missing_bom") ||
    args.planningRow?.reasonCodes.includes("missing_supplier")
  ) {
    return "blocked";
  }
  return "review";
}

function buildCoverageNeeds(args: {
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  inventory: AgentInventoryContext[];
  snapshot: PlanningSnapshot;
}): AgentCoverageNeedContext[] {
  const inventoryByItemId = new Map(args.inventory.map((item) => [item.itemId, item]));
  const planningRowsByItemId = new Map(
    args.snapshot.rows.map((row) => [row.item.id, row])
  );
  const needs: AgentCoverageNeedContext[] = [];

  for (const order of args.salesOrders) {
    for (const line of order.lines) {
      const shortQty = toQuantity(line.shortQty);
      if (shortQty <= 0) continue;

      const inventory = inventoryByItemId.get(line.itemId);
      const planningRow = planningRowsByItemId.get(line.itemId);
      const label = `${order.orderNumber} / ${line.itemName}`;
      const availableQty = toQuantity(inventory?.availableQty);
      const projectedQty = toQuantity(inventory?.projectedQty);
      needs.push({
        demandType: "sales_order_line",
        demandId: line.salesOrderLineId,
        demandLabel: label,
        itemId: line.itemId,
        itemName: line.itemName,
        unitName: line.unitName,
        priorityRank: order.priorityRank,
        requiredDate: order.requiredDate,
        requiredQty: line.openQty,
        coveredQty: line.coveredQty,
        shortQty: line.shortQty,
        coverageRankForItem: 0,
        availableQty: inventory?.availableQty ?? "0",
        availableQtyBeforeThisNeed: inventory?.availableQty ?? "0",
        availableQtyAfterThisNeed: inventory?.availableQty ?? "0",
        projectedQty: inventory?.projectedQty ?? planningRow?.projectedQuantity ?? "0",
        projectedQtyAfterThisNeed:
          inventory?.projectedQty ?? planningRow?.projectedQuantity ?? "0",
        readiness: coverageReadiness({
          shortQty,
          availableQty,
          projectedQty,
          planningRow,
        }),
        sourceRefs: [
          {
            sourceType: "sales_order",
            sourceId: order.salesOrderId,
            label: `${order.orderNumber}${order.customerName ? ` · ${order.customerName}` : ""}`,
            date: order.requiredDate,
          },
          sourceRef({
            sourceType: "sales_order_line",
            sourceId: line.salesOrderLineId,
            label,
            itemId: line.itemId,
            quantity: line.shortQty,
            date: order.requiredDate,
            parentSourceId: order.salesOrderId,
          }),
        ],
      });
    }
  }

  for (const order of args.manufacturingOrders) {
    for (const ingredient of order.ingredients) {
      const shortQty = toQuantity(ingredient.shortQty);
      if (shortQty <= 0) continue;

      const inventory = inventoryByItemId.get(ingredient.itemId);
      const planningRow = planningRowsByItemId.get(ingredient.itemId);
      const label = `${order.orderNumber} ingredient / ${ingredient.itemName}`;
      const availableQty = toQuantity(inventory?.availableQty);
      const projectedQty = toQuantity(inventory?.projectedQty);
      needs.push({
        demandType: "manufacturing_order_ingredient",
        demandId: ingredient.manufacturingOrderIngredientId,
        demandLabel: label,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        unitName: ingredient.unitName,
        priorityRank: order.priorityRank,
        requiredDate: order.plannedDate,
        requiredQty: quantityString(
          toQuantity(ingredient.requiredQty) - toQuantity(ingredient.pickedQty)
        ),
        coveredQty: "0",
        shortQty: ingredient.shortQty,
        coverageRankForItem: 0,
        availableQty: inventory?.availableQty ?? "0",
        availableQtyBeforeThisNeed: inventory?.availableQty ?? "0",
        availableQtyAfterThisNeed: inventory?.availableQty ?? "0",
        projectedQty: inventory?.projectedQty ?? planningRow?.projectedQuantity ?? "0",
        projectedQtyAfterThisNeed:
          inventory?.projectedQty ?? planningRow?.projectedQuantity ?? "0",
        readiness: coverageReadiness({
          shortQty,
          availableQty,
          projectedQty,
          planningRow,
        }),
        sourceRefs: [
          {
            sourceType: "manufacturing_order",
            sourceId: order.manufacturingOrderId,
            label: order.orderNumber,
            itemId: order.itemId,
            quantity: order.remainingQty,
            date: order.plannedDate,
          },
          sourceRef({
            sourceType: "manufacturing_order_ingredient",
            sourceId: ingredient.manufacturingOrderIngredientId,
            label,
            itemId: ingredient.itemId,
            quantity: ingredient.shortQty,
            date: order.plannedDate,
            parentSourceId: order.manufacturingOrderId,
          }),
        ],
      });
    }
  }

  const sortedNeeds = needs.sort((left, right) => {
    const leftPriority = left.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return (left.requiredDate ?? "9999-12-31").localeCompare(
      right.requiredDate ?? "9999-12-31"
    );
  });

  const availableRemainingByItemId = new Map<string, number>();
  const projectedRemainingByItemId = new Map<string, number>();
  const rankByItemId = new Map<string, number>();

  return sortedNeeds.map((need) => {
    const inventory = inventoryByItemId.get(need.itemId);
    const planningRow = planningRowsByItemId.get(need.itemId);
    const availableBefore = availableRemainingByItemId.has(need.itemId)
      ? (availableRemainingByItemId.get(need.itemId) ?? 0)
      : toQuantity(inventory?.availableQty);
    const projectedBefore = projectedRemainingByItemId.has(need.itemId)
      ? (projectedRemainingByItemId.get(need.itemId) ?? 0)
      : toQuantity(inventory?.projectedQty ?? planningRow?.projectedQuantity);
    const shortQty = toQuantity(need.shortQty);
    const availableAfter = roundQuantity(availableBefore - shortQty);
    const projectedAfter = roundQuantity(projectedBefore - shortQty);
    const coverageRankForItem = (rankByItemId.get(need.itemId) ?? 0) + 1;

    availableRemainingByItemId.set(need.itemId, Math.max(0, availableAfter));
    projectedRemainingByItemId.set(need.itemId, projectedAfter);
    rankByItemId.set(need.itemId, coverageRankForItem);

    return {
      ...need,
      coverageRankForItem,
      availableQtyBeforeThisNeed: quantityString(availableBefore),
      availableQtyAfterThisNeed: quantityString(availableAfter),
      projectedQtyAfterThisNeed: normalizeNumeric(roundQuantity(projectedAfter)),
      readiness: coverageReadiness({
        shortQty,
        availableQty: availableBefore,
        projectedQty: projectedBefore,
        planningRow,
      }),
    };
  });
}

function buildSupplyRecommendations(
  snapshot: PlanningSnapshot
): AgentSupplyRecommendationContext[] {
  const rowsByItemId = new Map(snapshot.rows.map((row) => [row.item.id, row]));

  return snapshot.recommendations
    .filter((recommendation) => recommendation.recommendationType !== "none")
    .map((recommendation) => {
      const row = rowsByItemId.get(recommendation.itemId);
      return {
        recommendationId: recommendation.id,
        recommendationType: recommendation.recommendationType,
        itemId: recommendation.itemId,
        itemName:
          row?.item.displayName ??
          recommendation.sourceRefs.find((ref) => ref.itemId === recommendation.itemId)
            ?.label ??
          recommendation.itemId,
        unitName: row?.item.unitName ?? null,
        quantity: recommendation.quantity,
        requiredDate: recommendation.requiredDate,
        latestStartDate: row?.latestStartDate ?? null,
        suggestedSupplierId: recommendation.suggestedSupplierId,
        suggestedSupplierName: recommendation.suggestedSupplierName,
        suggestedBomRevisionId: recommendation.suggestedBomRevisionId,
        reasonCodes: recommendation.reasonCodes,
        warnings: recommendation.warnings.map(sanitizeWarning),
        explanation: recommendation.explanation,
        sourceRefs: sanitizeSourceRefs(recommendation.sourceRefs),
      };
    });
}

function buildDecisionSupport(args: {
  salesOrders: AgentOpenSalesOrderContext[];
  manufacturingOrders: AgentOpenManufacturingOrderContext[];
  inventory: AgentInventoryContext[];
  snapshot: PlanningSnapshot;
}): AgentDecisionSupportContext {
  const coverageNeeds = buildCoverageNeeds(args);
  const supplyRecommendations = buildSupplyRecommendations(args.snapshot);
  const decisionQueue = buildDecisionQueue({
    coverageNeeds,
    supplyRecommendations,
    productionBlockers: args.snapshot.productionBlockerFacts.map(
      sanitizeProductionBlocker
    ),
  });

  return {
    decisionQueue,
    coverageNeeds,
    supplyRecommendations,
  };
}

function decisionQueueRank(item: AgentDecisionQueueItem) {
  switch (item.decisionType) {
    case "cover_demand":
      return item.readiness === "covered_by_available_inventory" ? 0 : 5;
    case "review_item_setup":
      return 1;
    case "resolve_blocker":
      return 2;
    case "create_manufacturing_order":
      return 3;
    case "create_purchase_order":
      return 4;
  }
}

function buildDecisionQueue(args: {
  coverageNeeds: AgentCoverageNeedContext[];
  supplyRecommendations: AgentSupplyRecommendationContext[];
  productionBlockers: AgentProductionBlockerFact[];
}): AgentDecisionQueueItem[] {
  const coverageItems: AgentDecisionQueueItem[] = args.coverageNeeds.map(
    (need) => ({
      decisionType: "cover_demand",
      severity:
        need.readiness === "covered_by_available_inventory" ? "warning" : "urgent",
      label:
        need.readiness === "covered_by_available_inventory"
          ? `${need.demandLabel} can be covered by available inventory`
          : `${need.demandLabel} needs supply before it can be covered`,
      itemId: need.itemId,
      itemName: need.itemName,
      unitName: need.unitName,
      quantity: need.shortQty,
      requiredDate: need.requiredDate,
      demandType: need.demandType,
      demandId: need.demandId,
      readiness: need.readiness,
      sourceRefs: need.sourceRefs,
    })
  );

  const recommendationItems: AgentDecisionQueueItem[] =
    args.supplyRecommendations.map((recommendation) => ({
      decisionType:
        recommendation.recommendationType === "create_manufacturing_order"
          ? "create_manufacturing_order"
          : recommendation.recommendationType === "create_purchase_order"
            ? "create_purchase_order"
            : "review_item_setup",
      severity:
        recommendation.recommendationType === "review_item_setup"
          ? "warning"
          : "info",
      label: recommendation.explanation,
      itemId: recommendation.itemId,
      itemName: recommendation.itemName,
      unitName: recommendation.unitName,
      quantity: recommendation.quantity,
      requiredDate: recommendation.requiredDate,
      recommendationId: recommendation.recommendationId,
      reasonCodes: recommendation.reasonCodes,
      sourceRefs: recommendation.sourceRefs,
    }));

  const blockerItems: AgentDecisionQueueItem[] = args.productionBlockers.map(
    (blocker) => ({
      decisionType: "resolve_blocker",
      severity:
        blocker.blockerType === "material_shortage" ||
        blocker.blockerType === "missing_bom"
          ? "urgent"
          : "warning",
      label:
        blocker.componentItemName && blocker.shortageQuantity
          ? `${blocker.parentItemName} is blocked by ${blocker.shortageQuantity} ${blocker.componentUnitName ?? ""} ${blocker.componentItemName}`.trim()
          : `${blocker.parentItemName} has a production blocker: ${blocker.blockerType}`,
      itemId: blocker.componentItemId ?? blocker.parentItemId,
      itemName: blocker.componentItemName ?? blocker.parentItemName,
      unitName: blocker.componentUnitName,
      quantity: blocker.shortageQuantity,
      requiredDate: blocker.earliestRequiredDate,
      blockerId: blocker.id,
      sourceRefs: blocker.sourceRefs,
    })
  );

  return [...coverageItems, ...recommendationItems, ...blockerItems].sort(
    (left, right) => {
      const rankDelta = decisionQueueRank(left) - decisionQueueRank(right);
      if (rankDelta !== 0) return rankDelta;
      const dateDelta = (left.requiredDate ?? "9999-12-31").localeCompare(
        right.requiredDate ?? "9999-12-31"
      );
      if (dateDelta !== 0) return dateDelta;
      return left.label.localeCompare(right.label);
    }
  );
}

function buildAttentionQueue(
  snapshot: PlanningSnapshot,
  decisionSupport: AgentDecisionSupportContext
): AgentAttentionQueueItem[] {
  const coverageItems: AgentAttentionQueueItem[] =
    decisionSupport.coverageNeeds.map((need) => ({
      type: "coverage_shortage",
      severity:
        need.readiness === "covered_by_available_inventory" ? "warning" : "urgent",
      label: `${need.demandLabel} needs ${need.shortQty} ${need.unitName ?? ""} covered`.trim(),
      sourceRefs: need.sourceRefs,
    }));

  const blockerItems: AgentAttentionQueueItem[] = snapshot.productionBlockerFacts.map(
    (rawBlocker) => {
      const blocker = sanitizeProductionBlocker(rawBlocker);
      return {
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
      };
    }
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
      sourceRefs: sanitizeSourceRefs(recommendation.sourceRefs),
    }));

  const warningItems: AgentAttentionQueueItem[] = snapshot.warnings.map((rawWarning) => {
    const warning = sanitizeWarning(rawWarning);
    return {
      type: "planning_warning",
      severity: warning.severity === "error" ? "urgent" : warning.severity,
      label: warning.message,
      sourceRefs: warning.sourceRefs,
    };
  });

  return [...coverageItems, ...blockerItems, ...recommendationItems, ...warningItems];
}

function markdownTable(headers: string[], rows: string[][]) {
  if (rows.length === 0) return "_None._";

  return [
    `| ${headers.map(mdCell).join(" |")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(" |")} |`),
  ].join("\n");
}

function omittedLine(total: number, shown: number, label: string) {
  const omitted = total - shown;
  return omitted > 0 ? `\n\n_${omitted} more ${label} omitted._` : "";
}

type MarkdownBuildTarget = {
  itemId: string;
  itemName: string;
  unitName: string | null;
  quantity: number;
  shipDate: string | null;
  buildByDate: string | null;
  reason: string;
  source: string;
  salesOrder: string;
};

function topLevelBomByProductId(context: AgentProductionPlanningContext) {
  return new Map(context.topLevelBoms.map((bom) => [bom.productItemId, bom]));
}

function inventoryByItemId(context: AgentProductionPlanningContext) {
  return new Map(context.inventory.map((item) => [item.itemId, item]));
}

function openMoSupplyByItemId(context: AgentProductionPlanningContext) {
  const supplyByItem = new Map<string, number>();
  for (const order of context.manufacturingOrders) {
    supplyByItem.set(
      order.itemId,
      roundQuantity((supplyByItem.get(order.itemId) ?? 0) + toQuantity(order.remainingQty))
    );
  }
  return supplyByItem;
}

function isProductionDecisionBomComponent(
  component: AgentTopLevelBomContext["components"][number]
) {
  if (component.minimumLotAgeDays != null) return true;
  return /\b(bag|pallet|tote|wrap|topper|label)\b/i.test(component.componentName);
}

function buildMarkdownTargets(context: AgentProductionPlanningContext) {
  const bomsByProductId = topLevelBomByProductId(context);
  const targets: MarkdownBuildTarget[] = [];

  for (const order of context.salesOrders) {
    for (const salesLine of order.lines) {
      const buildDemandQty = roundQuantity(
        Math.max(0, toQuantity(salesLine.openQty) - toQuantity(salesLine.coveredQty))
      );
      if (buildDemandQty <= 0) continue;

      targets.push({
        itemId: salesLine.itemId,
        itemName: salesLine.itemName,
        unitName: salesLine.unitName,
        quantity: buildDemandQty,
        shipDate: order.requiredDate,
        buildByDate: order.requiredDate,
        reason:
          salesLine.productionStatus === "available"
            ? "open sales demand; ERP says supply is available"
            : "open sales demand needs output",
        source: `${order.orderNumber} / ${salesLine.itemName}`,
        salesOrder: order.orderNumber,
      });

      const bom = bomsByProductId.get(salesLine.itemId);
      if (!bom) continue;

      for (const component of bom.components) {
        if (!component.minimumLotAgeDays) continue;
        const recipeBasis = normalizeRecipeBasis(bom.recipeBasis);
        const recipeOutputQuantity = Number(bom.outputQuantity);
        const numberOfBatches =
          recipeBasis === "batch" &&
          Number.isFinite(recipeOutputQuantity) &&
          recipeOutputQuantity > 0
            ? Math.ceil(buildDemandQty / recipeOutputQuantity)
            : null;
        const componentQuantity = toQuantity(
          calculateIngredientPlannedQuantity({
            recipeBasis,
            quantityPerRecipeBasis: component.quantity,
            outputQuantity: buildDemandQty,
            numberOfBatches,
          })
        );
        if (componentQuantity <= 0) continue;

        targets.push({
          itemId: component.componentItemId,
          itemName: component.componentName,
          unitName: component.unitName,
          quantity: componentQuantity,
          shipDate: order.requiredDate,
          buildByDate: subtractDays(order.requiredDate, component.minimumLotAgeDays),
          reason: `${component.minimumLotAgeDays} day age constraint for ${salesLine.itemName}`,
          source: `${order.orderNumber} / ${salesLine.itemName}`,
          salesOrder: order.orderNumber,
        });
      }
    }
  }

  return targets.sort((left, right) => {
    const dateDelta = (left.buildByDate ?? "9999-12-31").localeCompare(
      right.buildByDate ?? "9999-12-31"
    );
    if (dateDelta !== 0) return dateDelta;
    return left.itemName.localeCompare(right.itemName);
  });
}

function groupMarkdownTargets(targets: MarkdownBuildTarget[]) {
  const groups = new Map<string, MarkdownBuildTarget & { sources: Set<string> }>();

  for (const target of targets) {
    const key = [
      target.itemName,
      target.unitName ?? "",
      target.buildByDate ?? "",
      target.reason,
    ].join(":");
    const group = groups.get(key) ?? {
      ...target,
      quantity: 0,
      sources: new Set<string>(),
    };
    group.quantity = roundQuantity(group.quantity + target.quantity);
    group.shipDate = earliestDate(group.shipDate, target.shipDate);
    group.sources.add(target.salesOrder);
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => {
    const dateDelta = (left.buildByDate ?? "9999-12-31").localeCompare(
      right.buildByDate ?? "9999-12-31"
    );
    if (dateDelta !== 0) return dateDelta;
    return left.itemName.localeCompare(right.itemName);
  });
}

function buildRawProductionContext(
  context: AgentProductionPlanningContext
): AgentProductionRawContext {
  const salesDemandByItemId = new Map<
    string,
    { demandQty: number; coveredQty: number; shortQty: number }
  >();
  const openManufacturingSupplyByItemId = openMoSupplyByItemId(context);
  const inventoryItemIds = new Set<string>();

  for (const order of context.salesOrders) {
    for (const line of order.lines) {
      inventoryItemIds.add(line.itemId);
      const current = salesDemandByItemId.get(line.itemId) ?? {
        demandQty: 0,
        coveredQty: 0,
        shortQty: 0,
      };
      current.demandQty = roundQuantity(current.demandQty + toQuantity(line.openQty));
      current.coveredQty = roundQuantity(
        current.coveredQty + toQuantity(line.coveredQty)
      );
      current.shortQty = roundQuantity(
        current.shortQty + toQuantity(line.shortQty)
      );
      salesDemandByItemId.set(line.itemId, current);
    }
  }

  for (const order of context.manufacturingOrders) {
    inventoryItemIds.add(order.itemId);
  }
  for (const bom of context.topLevelBoms) {
    inventoryItemIds.add(bom.productItemId);
    for (const component of bom.components) {
      if (component.componentItemType === "product") {
        inventoryItemIds.add(component.componentItemId);
      }
    }
  }

  return {
    generatedAt: context.generatedAt,
    openSalesOrders: context.salesOrders.map((order) => ({
      salesOrderId: order.salesOrderId,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      status: order.status,
      orderDate: order.orderDate,
      shipDate: order.requiredDate,
      unplannedDemand: order.lines
        .map((line) => {
          const remainingToPlanQty = toQuantity(line.openQty);
          if (remainingToPlanQty <= 0) return null;
          const coveredQty = Math.min(
            remainingToPlanQty,
            toQuantity(line.coveredQty)
          );
          return {
            salesOrderLineId: line.salesOrderLineId,
            itemId: line.itemId,
            itemName: line.itemName,
            unitName: line.unitName,
            orderedQty: line.orderedQty,
            shippedQty: line.shippedQty,
            cancelledQty: line.cancelledQty,
            remainingToPlanQty: quantityString(remainingToPlanQty),
            coveredQty: quantityString(coveredQty),
            shortQty: quantityString(Math.max(0, remainingToPlanQty - coveredQty)),
            productionStatus: line.productionStatus,
          };
        })
        .filter(
          (line): line is NonNullable<typeof line> => line != null
        ),
    })),
    openManufacturingOrders: context.manufacturingOrders.map((order) => ({
      manufacturingOrderId: order.manufacturingOrderId,
      orderNumber: order.orderNumber,
      status: order.status,
      itemId: order.itemId,
      itemName: order.itemName,
      unitName: order.unitName,
      plannedQty: order.plannedQty,
      completedQty: order.completedQty,
      remainingQty: order.remainingQty,
      plannedDate: order.plannedDate,
      expectedOutputDate: order.expectedOutputDate,
      linkedSalesOrderId: order.salesOrderId,
      linkedSalesOrderLineId: order.salesOrderLineId,
    })),
    productCounts: context.inventory
      .filter((item) => inventoryItemIds.has(item.itemId))
      .map((item) => {
        const salesDemand = salesDemandByItemId.get(item.itemId);
        return {
          itemId: item.itemId,
          itemName: item.itemName,
          unitName: item.unitName,
          onHandQty: item.onHandQty,
          availableQty: item.availableQty,
          expectedQty: item.expectedQty,
          openSalesDemandQty: quantityString(salesDemand?.demandQty ?? 0),
          openSalesCoveredQty: quantityString(salesDemand?.coveredQty ?? 0),
          openSalesShortQty: quantityString(salesDemand?.shortQty ?? 0),
          openManufacturingSupplyQty: quantityString(
            openManufacturingSupplyByItemId.get(item.itemId) ?? 0
          ),
          lotCounts: item.lots.map((lot) => ({
            lotId: lot.lotId,
            lotCode: lot.lotCode,
            receivedDate: lot.receivedDate?.slice(0, 10) ?? null,
            ageDays: lot.receivedDate
              ? Math.max(
                  0,
                  Math.floor(
                    (new Date(context.generatedAt).getTime() -
                      new Date(lot.receivedDate).getTime()) /
                      86_400_000
                  )
                )
              : null,
            disposition: lot.disposition,
            onHandQty: lot.onHandQty,
            availableQty: lot.availableQty,
          })),
        };
      }),
    productBoms: context.topLevelBoms
      .map((bom) => ({
        productItemId: bom.productItemId,
        productName: bom.productName,
        unitName: bom.unitName,
        revisionId: bom.revisionId,
        revisionNumber: bom.revisionNumber,
        components: bom.components
          .filter((component) => component.componentItemType === "product")
          .map((component) => ({
            bomRevisionComponentId: component.bomRevisionComponentId,
            componentItemId: component.componentItemId,
            componentName: component.componentName,
            componentItemType: component.componentItemType,
            componentUnitName: component.unitName,
            quantity: component.quantity,
            quantityMeaning:
              bom.recipeBasis === "batch"
                ? `${component.quantity} ${component.unitName ?? "units"} of ${component.componentName} per production batch of ${bom.productName}`
                : `${component.quantity} ${component.unitName ?? "units"} of ${component.componentName} per output of ${bom.productName}`,
            requirements: component.constraints.map((constraint) => {
              if (constraint.minimumLotAgeDays != null) {
                return {
                  type: "minimum_lot_age_days" as const,
                  days: constraint.minimumLotAgeDays,
                };
              }
              return { type: constraint.type };
            }),
          })),
      }))
      .filter((bom) => bom.components.length > 0),
  };
}

export function buildAgentProductionPlanningRawJson(
  context: AgentProductionPlanningContext
) {
  return buildRawProductionContext(context);
}

export function buildAgentProductionPlanningMarkdown(
  context: AgentProductionPlanningContext
) {
  const today = context.today;
  const inventory = inventoryByItemId(context);
  const openMoSupply = openMoSupplyByItemId(context);
  const targets = groupMarkdownTargets(buildMarkdownTargets(context));
  const dueTargets = targets.filter(
    (target) => !target.buildByDate || target.buildByDate <= today
  );
  const futureTargets = targets.filter(
    (target) => target.buildByDate && target.buildByDate > today
  );

  const salesDemandRows = context.salesOrders
    .flatMap((order) =>
      order.lines.map((salesLine) => [
        order.orderNumber,
        order.customerName ?? "-",
        compactDate(order.orderDate),
        compactDate(order.requiredDate),
        salesLine.itemName,
        compactQty(salesLine.openQty, salesLine.unitName),
        compactQty(salesLine.coveredQty, salesLine.unitName),
        compactQty(salesLine.shortQty, salesLine.unitName),
        salesLine.productionStatus,
      ])
    )
    .slice(0, MAX_MARKDOWN_SALES_DEMAND);

  const buildRows = dueTargets.slice(0, MAX_MARKDOWN_BUILD_TODAY).map((target) => {
    const itemInventory = inventory.get(target.itemId);
    return [
      target.itemName,
      compactQty(quantityString(target.quantity), target.unitName),
      compactDate(target.buildByDate),
      compactDate(target.shipDate),
      target.reason,
      itemInventory?.availableQty ?? "-",
      quantityString(openMoSupply.get(target.itemId) ?? 0),
      [...target.sources].slice(0, 4).join(", "),
    ];
  });

  const upcomingRows = futureTargets
    .slice(0, MAX_MARKDOWN_UPCOMING_BUILDS)
    .map((target) => [
      target.itemName,
      compactQty(quantityString(target.quantity), target.unitName),
      compactDate(target.buildByDate),
      compactDate(target.shipDate),
      target.reason,
      [...target.sources].slice(0, 4).join(", "),
    ]);

  const openMoRows = context.manufacturingOrders
    .slice(0, MAX_MARKDOWN_OPEN_MOS)
    .map((order) => [
      order.orderNumber,
      order.itemName,
      compactQty(order.remainingQty, order.unitName),
      compactDate(order.plannedDate),
      order.salesOrderLineId ? "MTO" : "-",
    ]);

  const productionDecisionBomComponents = context.topLevelBoms.flatMap((bom) =>
    bom.components
      .filter(isProductionDecisionBomComponent)
      .map((component) => ({ bom, component }))
  );
  const bomRows = productionDecisionBomComponents
    .map(({ bom, component }) => [
      bom.productName,
      component.componentName,
      compactQty(component.quantity, component.unitName),
      bom.recipeBasis,
      component.constraints.map((constraint) => constraint.label).join(", ") || "-",
    ])
    .slice(0, MAX_MARKDOWN_TOP_LEVEL_BOMS);

  return [
    line("# Production Planning Brief"),
    line(),
    line(`Generated: ${context.generatedAt}`),
    line(`Today: ${context.today}`),
    line(`Input hash: ${context.inputHash}`),
    line(),
    line("## Question"),
    line(
      "Answer only what bags, totes, or pallets need to be made for open sales demand. Do not recommend purchase orders from this brief."
    ),
    line(
      `Open sales orders: ${context.summary.openSalesOrderCount}; open sales lines: ${context.summary.openSalesOrderLineCount}; open MOs: ${context.summary.openManufacturingOrderCount}.`
    ),
    line(),
    line("## Build Today Or Late"),
    line(
      markdownTable(
        [
          "Item",
          "Qty",
          "Build by",
          "Delivery deadline",
          "Why",
          "Avail now",
          "Open MO supply",
          "Sales orders",
        ],
        buildRows
      ) + omittedLine(dueTargets.length, buildRows.length, "due build targets")
    ),
    line(),
    line("## Upcoming Build Queue"),
    line(
      markdownTable(
        ["Item", "Qty", "Build by", "Delivery deadline", "Why", "Sales orders"],
        upcomingRows
      ) + omittedLine(futureTargets.length, upcomingRows.length, "upcoming build targets")
    ),
    line(),
    line("## Sales Demand"),
    line(
      markdownTable(
        [
          "SO",
          "Customer",
          "Order date",
          "Delivery deadline",
          "Item",
          "Open",
          "Covered",
          "Short",
          "Status",
        ],
        salesDemandRows
      ) +
        omittedLine(
          context.salesOrders.reduce((sum, order) => sum + order.lines.length, 0),
          salesDemandRows.length,
          "sales demand lines"
        )
    ),
    line(),
    line("## Open Manufacturing Supply"),
    line(
      markdownTable(
        ["MO", "Output", "Remaining", "Planned date", "Link"],
        openMoRows
      ) +
        omittedLine(
          context.manufacturingOrders.length,
          openMoRows.length,
          "open manufacturing orders"
        )
    ),
    line(),
    line("## Top-Level BOM Build Constraints"),
    line(
      markdownTable(["Product", "Component", "Qty", "Mode", "Constraint"], bomRows) +
        omittedLine(
          productionDecisionBomComponents.length,
          bomRows.length,
          "top-level BOM components"
        )
    ),
    line(),
    line("## Rules"),
    line("- This is read-only. Do not claim MOs or POs were created."),
    line("- A constrained component must be built or received by the build-by date so it can age before the sales order ships."),
    line("- Use open manufacturing supply before recommending new manufacturing orders."),
  ].join("\n");
}

async function buildAgentProductionPlanningContextInTx(
  tx: Tx,
  orgId: string,
  options: Required<AgentProductionPlanningContextOptions>
): Promise<AgentProductionPlanningContext> {
  const snapshot = await buildPlanningSnapshotInTx(tx, orgId);
  const today = await loadOrganizationTodayInTx(tx, orgId);
  const salesOrders = await loadOpenSalesOrdersInTx(tx, snapshot);
  const manufacturingOrders = await loadOpenManufacturingOrdersInTx(tx);
  const purchaseOrders = await loadOpenPurchaseOrdersInTx(tx);
  const topLevelBoms = await loadTopLevelBomContextInTx(
    tx,
    salesOrders,
    manufacturingOrders
  );
  const relevantItemIds = new Set(
    collectRelevantItemIds({
      snapshot,
      salesOrders,
      manufacturingOrders,
      purchaseOrders,
    })
  );
  for (const bom of topLevelBoms) {
    relevantItemIds.add(bom.productItemId);
    for (const component of bom.components) {
      if (component.componentItemType === "product") {
        relevantItemIds.add(component.componentItemId);
      }
    }
  }
  const inventory = await loadRelevantInventoryContextInTx(tx, {
    itemIds: [...relevantItemIds].sort(),
    snapshot,
    includeLots: options.includeLots,
  });
  const decisionSupport = buildDecisionSupport({
    salesOrders,
    manufacturingOrders,
    inventory,
    snapshot,
  });
  const supplyRecommendationCounts = decisionSupport.supplyRecommendations.reduce(
    (counts, recommendation) => {
      if (recommendation.recommendationType === "create_manufacturing_order") {
        counts.makeRecommendationCount += 1;
      } else if (recommendation.recommendationType === "create_purchase_order") {
        counts.buyRecommendationCount += 1;
      } else if (recommendation.recommendationType === "review_item_setup") {
        counts.reviewItemSetupCount += 1;
      }
      return counts;
    },
    {
      makeRecommendationCount: 0,
      buyRecommendationCount: 0,
      reviewItemSetupCount: 0,
    }
  );

  return {
    orgId: snapshot.orgId,
    generatedAt: snapshot.generatedAt,
    today,
    inputHash: snapshot.inputHash,
    summary: {
      openSalesOrderCount: salesOrders.length,
      openSalesOrderLineCount: salesOrders.reduce(
        (sum, order) => sum + order.lines.length,
        0
      ),
      openManufacturingOrderCount: manufacturingOrders.length,
      openPurchaseOrderCount: purchaseOrders.length,
      relevantItemCount: inventory.length,
      coverageNeedCount: decisionSupport.coverageNeeds.length,
      coverableNowCount: decisionSupport.coverageNeeds.filter(
        (need) => need.readiness === "covered_by_available_inventory"
      ).length,
      supplyRecommendationCount: decisionSupport.supplyRecommendations.length,
      ...supplyRecommendationCounts,
      recommendationCount: snapshot.recommendations.filter(
        (recommendation) => recommendation.recommendationType !== "none"
      ).length,
      productionBlockerCount: snapshot.productionBlockerFacts.length,
    },
    attentionQueue: buildAttentionQueue(snapshot, decisionSupport),
    salesOrders,
    manufacturingOrders,
    purchaseOrders,
    inventory,
    decisionSupport,
    topLevelBoms,
    planning: {
      horizonStart: snapshot.horizonStart,
      horizonEnd: snapshot.horizonEnd,
      assumptions: snapshot.assumptions,
      inputHash: snapshot.inputHash,
      rows: snapshot.rows.map(sanitizePlanningRow),
      recommendations: snapshot.recommendations.map(sanitizeRecommendation),
      productionBlockers: snapshot.productionBlockerFacts.map(
        sanitizeProductionBlocker
      ),
      demandFacts: options.includePlanningFacts ? snapshot.demandFacts : [],
      supplyFacts: options.includePlanningFacts ? snapshot.supplyFacts : [],
      inventoryFacts: options.includePlanningFacts ? snapshot.inventoryFacts : [],
      bomRequirements: options.includePlanningFacts
        ? snapshot.bomRequirementFacts.map(sanitizeBomRequirement)
        : [],
      salesOrderProductionDemandPaths: snapshot.salesOrderProductionDemandPaths,
      warnings: snapshot.warnings.map(sanitizeWarning),
    },
    allowedNextActions: [
      {
        action: "read_production_planning_context",
        status: "allowed",
        description:
          "This endpoint is read-only. Use the ERP UI for manufacturing orders and purchase orders.",
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
