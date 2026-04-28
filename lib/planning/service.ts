import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  supplierItems,
  salesOrderLines,
  salesOrders,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  projectedCommittedQty,
  projectedExpectedQty,
  projectedOnHandQty,
} from "@/lib/inventory/kernel";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import type {
  BomRequirementFact,
  DemandFact,
  DaysOfCoverStatus,
  InventoryFact,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningReasonCode,
  PlanningRuleSource,
  PlanningSnapshot,
  PlanningSourceRef,
  PlanningWarning,
  ProductionBlockerFact,
  ProductionBucket,
  SupplyFact,
} from "./types";

const MAX_BOM_EXPLOSION_LEVEL = 8;
const DEFAULT_COVER_HORIZON_DAYS = 90;

type PlanningItemRecord = {
  id: string;
  name: string;
  displayName: string;
  displayAttrs: string[];
  sku: string | null;
  itemType: string;
  unitName: string | null;
  unitUom: string | null;
  safetyStock: string;
  targetCoverDays: string | null;
  planningEnabled: boolean;
  leadTimeDaysOverride: string | null;
  onHandQuantity: string;
  reservedQuantity: string;
  expectedQuantity: string;
  defaultPurchasePrice: string | null;
  purchaseUnitDefinitionId: string | null;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  manufacturingMode: string;
  expectedBatchYield: string | null;
  productionLeadTimeDays: string | null;
};

type BomComponentRecord = {
  componentId: string;
  componentName: string;
  componentSku: string | null;
  componentItemType: string;
  unitName: string;
  quantity: string;
  sortOrder: number;
};

type CurrentBomRecord = {
  revisionId: string;
  revisionNumber: number;
  components: BomComponentRecord[];
};

type SupplierSuggestion = {
  supplierId: string | null;
  supplierName: string | null;
  supplierSku: string | null;
  supplierSource: PlanningRuleSource;
  unitCost: string | null;
  unitCostSource: PlanningRuleSource;
  purchaseUnitDefinitionId: string | null;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  purchaseRuleSource: PlanningRuleSource;
  leadTimeDaysOverride: number | null;
  minimumOrderQuantity: string | null;
  orderMultiple: string | null;
  reasonCodes: PlanningReasonCode[];
};

type LeadTimeHistory = {
  leadTimeDays: number;
  sampleCount: number;
};

type InternalDemandFact = DemandFact & {
  explosionPath: string[];
};

type QuantityBuckets = {
  demandQuantity: number;
  incomingPurchaseOrderQuantity: number;
  incomingManufacturingOrderQuantity: number;
};

function toQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuantity(value: number) {
  return normalizeNumeric(roundQuantity(value));
}

function positiveQuantity(value: number) {
  return Math.max(0, roundQuantity(value));
}

function nullableNumber(value: string | null | undefined) {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function subtractDays(value: string, days: number) {
  return addDays(value, -days);
}

function daysBetween(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  return Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)
  );
}

function productionBucketForDate(
  value: string | null,
  horizonStart: string
): ProductionBucket {
  if (!value) return "later";
  const days = daysBetween(horizonStart, value);
  if (value <= horizonStart) return "now";
  if (days <= 7) return "this-week";
  if (days <= 14) return "next-week";
  return "later";
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function sourceRefKey(ref: PlanningSourceRef) {
  return [
    ref.sourceType,
    ref.sourceId,
    ref.itemId ?? "",
    ref.quantity ?? "",
    ref.date ?? "",
    ref.parentSourceId ?? "",
  ].join(":");
}

function uniqueSourceRefs(refs: PlanningSourceRef[]) {
  const byKey = new Map<string, PlanningSourceRef>();
  for (const ref of refs) {
    byKey.set(sourceRefKey(ref), ref);
  }

  return [...byKey.values()].sort((left, right) =>
    sourceRefKey(left).localeCompare(sourceRefKey(right))
  );
}

function uniqueReasonCodes(codes: PlanningReasonCode[]) {
  return [...new Set(codes)].sort();
}

function earliestDate(values: Array<string | null | undefined>) {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) {
    return null;
  }

  return dates.sort()[0];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function buildRecommendationId(args: {
  recommendationType: PlanningRecommendation["recommendationType"];
  itemId: string;
  quantity: string;
  sourceRefs: PlanningSourceRef[];
}) {
  const digest = hashValue({
    recommendationType: args.recommendationType,
    itemId: args.itemId,
    quantity: args.quantity,
    sourceRefs: uniqueSourceRefs(args.sourceRefs),
  }).slice(0, 20);

  return `planning_${digest}`;
}

function itemRef(item: Pick<PlanningItemRecord, "id" | "name">): PlanningSourceRef {
  return {
    sourceType: "item",
    sourceId: item.id,
    itemId: item.id,
    label: item.name,
  };
}

async function getPlanningItemsInTx(tx: Tx): Promise<PlanningItemRecord[]> {
  const masterItems = alias(items, "planning_master_items");
  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      unitUom: unitDefinitions.uom,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
      targetCoverDays: trimScaleNullable(items.targetCoverDays).as("targetCoverDays"),
      planningEnabled: items.planningEnabled,
      leadTimeDaysOverride: trimScaleNullable(items.leadTimeDaysOverride).as(
        "leadTimeDaysOverride"
      ),
      onHandQuantity: projectedOnHandQty(items.organizationId, items.id).as(
        "onHandQuantity"
      ),
      reservedQuantity: projectedCommittedQty(items.organizationId, items.id).as(
        "reservedQuantity"
      ),
      expectedQuantity: projectedExpectedQty(items.organizationId, items.id).as(
        "expectedQuantity"
      ),
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice"
      ),
      purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = ${items.purchaseUnitDefinitionId}
      )`,
      purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
        "purchaseToStockFactor"
      ),
      manufacturingMode: items.manufacturingMode,
      expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
        "expectedBatchYield"
      ),
      productionLeadTimeDays: trimScaleNullable(items.productionLeadTimeDays).as(
        "productionLeadTimeDays"
      ),
    })
    .from(items)
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(and(isNull(items.deletedAt), eq(items.isMaster, false)))
    .orderBy(asc(items.name), asc(items.id));

  return rows.map((row) => {
    const display = resolveVariantDisplay(
      row.name,
      { name: row.masterName, variantAxes: row.masterVariantAxes },
      row.variantAttrs
    );

    return {
      ...row,
      displayName: display.masterName,
      displayAttrs: display.attrs,
    };
  });
}

async function getSalesDemandFactsInTx(tx: Tx): Promise<InternalDemandFact[]> {
  const rows = await tx
    .select({
      salesOrderId: salesOrders.id,
      salesOrderLineId: salesOrderLines.id,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      requestedDate: salesOrders.requestedDate,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(and(eq(salesOrders.status, "confirmed"), isNull(salesOrders.deletedAt)))
    .orderBy(
      asc(salesOrders.requestedDate),
      asc(salesOrders.orderNumber),
      asc(salesOrderLines.sortOrder),
      asc(salesOrderLines.id)
    );

  return rows.map((row) => ({
    id: `demand:sales:${row.salesOrderLineId}`,
    itemId: row.itemId,
    demandType: "sales_order",
    quantity: row.quantity,
    requiredDate: row.requestedDate,
    reasonCodes: ["sales_order_demand"],
    sourceRefs: [
      {
        sourceType: "sales_order",
        sourceId: row.salesOrderId,
        label: `${row.orderNumber} · ${row.customerName}`,
        date: row.requestedDate,
      },
      {
        sourceType: "sales_order_line",
        sourceId: row.salesOrderLineId,
        label: `${row.orderNumber} / ${row.itemName}`,
        itemId: row.itemId,
        quantity: row.quantity,
        date: row.requestedDate,
        parentSourceId: row.salesOrderId,
      },
    ],
    explanation: `${row.orderNumber} needs ${row.quantity} ${row.itemName}.`,
    explosionPath: [row.itemId],
  }));
}

function getSafetyStockDemandFacts(itemsList: PlanningItemRecord[]) {
  return itemsList
    .filter((item) => toQuantity(item.safetyStock) > 0)
    .map((item) => ({
      id: `demand:safety:${item.id}`,
      itemId: item.id,
      demandType: "safety_stock" as const,
      quantity: item.safetyStock,
      requiredDate: null,
      reasonCodes: ["safety_stock_demand"] as PlanningReasonCode[],
      sourceRefs: [
        {
          sourceType: "safety_stock" as const,
          sourceId: `safety:${item.id}`,
          label: `Safety stock for ${item.name}`,
          itemId: item.id,
          quantity: item.safetyStock,
        },
      ],
      explanation: `Safety stock target is ${item.safetyStock}.`,
      explosionPath: [item.id],
    }));
}

async function getOpenManufacturingComponentDemandFactsInTx(
  tx: Tx
): Promise<InternalDemandFact[]> {
  const remainingQuantity = trimScale(
    sql`GREATEST(${manufacturingOrderIngredients.plannedQuantity} - ${manufacturingOrderIngredients.pickedQuantity}, 0)`
  );

  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      manufacturingOrderNumber: manufacturingOrders.orderNumber,
      plannedDate: manufacturingOrders.plannedDate,
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.status, "released"),
        isNull(manufacturingOrders.deletedAt),
        sql`${manufacturingOrderIngredients.plannedQuantity} > ${manufacturingOrderIngredients.pickedQuantity}`
      )
    )
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder),
      asc(manufacturingOrderIngredients.id)
    );

  return rows.map((row) => ({
    id: `demand:manufacturing:${row.ingredientId}`,
    itemId: row.itemId,
    demandType: "manufacturing_component",
    quantity: row.quantity,
    requiredDate: row.plannedDate,
    reasonCodes: ["manufacturing_component_demand"],
    sourceRefs: [
      {
        sourceType: "manufacturing_order",
        sourceId: row.manufacturingOrderId,
        label: row.manufacturingOrderNumber,
        itemId: row.productId,
        date: row.plannedDate,
      },
      {
        sourceType: "manufacturing_order_ingredient",
        sourceId: row.ingredientId,
        label: `${row.manufacturingOrderNumber} / ${row.itemName}`,
        itemId: row.itemId,
        quantity: row.quantity,
        date: row.plannedDate,
        parentSourceId: row.manufacturingOrderId,
      },
    ],
    parentItemId: row.productId,
    explanation: `${row.manufacturingOrderNumber} needs ${row.quantity} ${row.itemName} for ${row.productName}.`,
    explosionPath: [row.productId, row.itemId],
  }));
}

function getInventoryFacts(itemsList: PlanningItemRecord[]): InventoryFact[] {
  return itemsList.map((item) => {
    const onHandQuantity = toQuantity(item.onHandQuantity);
    const reservedQuantity = toQuantity(item.reservedQuantity);
    const availableQuantity = positiveQuantity(onHandQuantity - reservedQuantity);

    return {
      itemId: item.id,
      onHandQuantity: normalizeQuantity(onHandQuantity),
      reservedQuantity: normalizeQuantity(reservedQuantity),
      availableQuantity: normalizeQuantity(availableQuantity),
      expectedQuantity: item.expectedQuantity,
      sourceRefs: [itemRef(item)],
    };
  });
}

function getInventorySupplyFacts(
  itemsList: PlanningItemRecord[],
  inventoryFacts: InventoryFact[]
): SupplyFact[] {
  const itemById = new Map(itemsList.map((item) => [item.id, item]));

  return inventoryFacts
    .filter((fact) => toQuantity(fact.onHandQuantity) > 0)
    .map((fact) => {
      const item = itemById.get(fact.itemId);
      return {
        id: `supply:inventory:${fact.itemId}`,
        itemId: fact.itemId,
        supplyType: "available_inventory",
        quantity: fact.onHandQuantity,
        expectedDate: null,
        status: "on_hand",
        reasonCodes: ["inventory_available"],
        sourceRefs: fact.sourceRefs,
        explanation: `${item?.name ?? "Item"} has ${fact.onHandQuantity} on hand.`,
      };
    });
}

async function getPurchaseSupplyFactsInTx(tx: Tx): Promise<SupplyFact[]> {
  const remainingQuantity = trimScale(
    sql`GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}, 0)`
  );

  const rows = await tx
    .select({
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderLineId: purchaseOrderLines.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierName: purchaseOrders.supplierName,
      status: purchaseOrders.status,
      expectedDate: purchaseOrders.expectedDate,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrderLines.stockQuantityOrdered} > ${purchaseOrderLines.stockQuantityReceived}`
      )
    )
    .orderBy(
      asc(purchaseOrders.expectedDate),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.id)
    );

  return rows.map((row) => ({
    id: `supply:purchase:${row.purchaseOrderLineId}`,
    itemId: row.itemId,
    supplyType: "purchase_order",
    quantity: row.quantity,
    expectedDate: row.expectedDate,
    status: row.status,
    reasonCodes: ["open_purchase_supply"],
    sourceRefs: [
      {
        sourceType: "purchase_order",
        sourceId: row.purchaseOrderId,
        label: row.orderNumber,
        date: row.expectedDate,
      },
      {
        sourceType: "purchase_order_line",
        sourceId: row.purchaseOrderLineId,
        label: `${row.orderNumber} / ${row.itemName}`,
        itemId: row.itemId,
        quantity: row.quantity,
        date: row.expectedDate,
        parentSourceId: row.purchaseOrderId,
      },
    ],
    explanation: `${row.orderNumber} from ${row.supplierName} has ${row.quantity} incoming.`,
  }));
}

async function getManufacturingSupplyFactsInTx(tx: Tx): Promise<SupplyFact[]> {
  const completedBatchQuantity = sql`COALESCE((
    SELECT SUM(${manufacturingOrderBatches.actualQuantity})
    FROM ${manufacturingOrderBatches}
    WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
      AND ${manufacturingOrderBatches.status} = 'completed'
  ), 0)`;
  const remainingQuantity = trimScale(sql`GREATEST(
    ${manufacturingOrders.plannedQuantity} - CASE
      WHEN ${manufacturingOrders.manufacturingMode} = 'batch'
        THEN ${completedBatchQuantity}
      ELSE 0
    END,
    0
  )`);

  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      plannedDate: manufacturingOrders.plannedDate,
      itemId: manufacturingOrders.productId,
      itemName: manufacturingOrders.productName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.status, "released"), isNull(manufacturingOrders.deletedAt)))
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrders.id)
    );

  return rows
    .filter((row) => toQuantity(row.quantity) > 0)
    .map((row) => ({
      id: `supply:manufacturing:${row.manufacturingOrderId}`,
      itemId: row.itemId,
      supplyType: "manufacturing_order",
      quantity: row.quantity,
      expectedDate: row.plannedDate,
      status: row.status,
      reasonCodes: ["open_manufacturing_supply"],
      sourceRefs: [
        {
          sourceType: "manufacturing_order",
          sourceId: row.manufacturingOrderId,
          label: row.orderNumber,
          itemId: row.itemId,
          quantity: row.quantity,
          date: row.plannedDate,
        },
      ],
      explanation: `${row.orderNumber} has ${row.quantity} ${row.itemName} incoming.`,
    }));
}

async function getCurrentBomsInTx(
  tx: Tx,
  productIds: string[]
): Promise<Map<string, CurrentBomRecord>> {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) {
    return new Map();
  }

  const revisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true)
      )
    )
    .orderBy(asc(bomRevisions.productId), asc(bomRevisions.revisionNumber));

  if (revisions.length === 0) {
    return new Map();
  }

  const components = await tx
    .select({
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentId: bomRevisionComponents.componentId,
      componentName: items.name,
      componentSku: items.sku,
      componentItemType: items.itemType,
      unitName: unitDefinitions.name,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .innerJoin(items, eq(bomRevisionComponents.componentId, items.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(
          bomRevisionComponents.bomRevisionId,
          revisions.map((revision) => revision.id)
        ),
        isNull(items.deletedAt)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.bomRevisionId),
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );

  const componentsByRevision = new Map<string, BomComponentRecord[]>();
  for (const component of components) {
    const bucket = componentsByRevision.get(component.bomRevisionId) ?? [];
    bucket.push({
      componentId: component.componentId,
      componentName: component.componentName,
      componentSku: component.componentSku,
      componentItemType: component.componentItemType,
      unitName: component.unitName,
      quantity: component.quantity,
      sortOrder: component.sortOrder,
    });
    componentsByRevision.set(component.bomRevisionId, bucket);
  }

  return new Map(
    revisions.map((revision) => [
      revision.productId,
      {
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        components: componentsByRevision.get(revision.id) ?? [],
      },
    ])
  );
}

async function getSupplierSuggestionsInTx(
  tx: Tx,
  itemsList: PlanningItemRecord[]
): Promise<Map<string, SupplierSuggestion>> {
  const uniqueItemIds = [
    ...new Set(
      itemsList.filter((item) => item.itemType === "material").map((item) => item.id)
    ),
  ];
  const itemById = new Map(itemsList.map((item) => [item.id, item]));
  const activeSuppliers = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt))
    .orderBy(asc(suppliers.name), asc(suppliers.id));

  const suggestions = new Map<string, SupplierSuggestion>();

  if (uniqueItemIds.length > 0) {
    const supplierRuleRows = await tx
      .select({
        itemId: supplierItems.itemId,
        supplierId: supplierItems.supplierId,
        supplierName: suppliers.name,
        supplierSku: supplierItems.supplierSku,
        unitCost: trimScaleNullable(supplierItems.unitCost).as("unitCost"),
        purchaseUnitDefinitionId: supplierItems.purchaseUnitDefinitionId,
        purchaseUnitName: unitDefinitions.name,
        purchaseToStockFactor: trimScaleNullable(
          supplierItems.purchaseToStockFactor
        ).as("purchaseToStockFactor"),
        leadTimeDaysOverride: trimScaleNullable(
          supplierItems.leadTimeDaysOverride
        ).as("leadTimeDaysOverride"),
        minimumOrderQuantity: trimScaleNullable(
          supplierItems.minimumOrderQuantity
        ).as("minimumOrderQuantity"),
        orderMultiple: trimScaleNullable(supplierItems.orderMultiple).as(
          "orderMultiple"
        ),
        isPreferred: supplierItems.isPreferred,
        createdAt: supplierItems.createdAt,
      })
      .from(supplierItems)
      .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
      .leftJoin(
        unitDefinitions,
        eq(supplierItems.purchaseUnitDefinitionId, unitDefinitions.id)
      )
      .where(
        and(
          inArray(supplierItems.itemId, uniqueItemIds),
          isNull(supplierItems.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(
        desc(supplierItems.isPreferred),
        asc(suppliers.name),
        desc(supplierItems.createdAt)
      );

    const supplierRulesByItem = new Map<string, typeof supplierRuleRows>();
    for (const row of supplierRuleRows) {
      const bucket = supplierRulesByItem.get(row.itemId) ?? [];
      bucket.push(row);
      supplierRulesByItem.set(row.itemId, bucket);
    }

    for (const [itemId, rules] of supplierRulesByItem) {
      const preferredRules = rules.filter((rule) => rule.isPreferred);
      const candidate =
        preferredRules.length === 1
          ? preferredRules[0]
          : preferredRules.length === 0 && rules.length === 1
            ? rules[0]
            : null;

      if (!candidate) {
        continue;
      }

      const item = itemById.get(itemId);
      suggestions.set(itemId, {
        supplierId: candidate.supplierId,
        supplierName: candidate.supplierName,
        supplierSku: candidate.supplierSku,
        supplierSource: "supplier_item",
        unitCost: candidate.unitCost ?? item?.defaultPurchasePrice ?? null,
        unitCostSource:
          candidate.unitCost != null
            ? "supplier_item"
            : item?.defaultPurchasePrice != null
              ? "item_default"
              : "unknown",
        purchaseUnitDefinitionId:
          candidate.purchaseUnitDefinitionId ?? item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: candidate.purchaseUnitName ?? item?.purchaseUnitName ?? null,
        purchaseToStockFactor:
          candidate.purchaseToStockFactor ?? item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          candidate.purchaseUnitDefinitionId != null ||
          candidate.purchaseToStockFactor != null
            ? "supplier_item"
            : item?.purchaseUnitDefinitionId != null ||
                item?.purchaseToStockFactor != null
              ? "item_default"
              : "default",
        leadTimeDaysOverride: nullableNumber(candidate.leadTimeDaysOverride),
        minimumOrderQuantity: candidate.minimumOrderQuantity,
        orderMultiple: candidate.orderMultiple,
        reasonCodes: [],
      });
    }

    const supplierHistory = await tx
      .select({
        itemId: purchaseOrderLines.itemId,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
      })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          inArray(purchaseOrderLines.itemId, uniqueItemIds),
          isNull(purchaseOrders.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(
        desc(purchaseOrders.createdAt),
        desc(purchaseOrders.id),
        asc(suppliers.name)
      );

    for (const row of supplierHistory) {
      if (suggestions.has(row.itemId)) {
        continue;
      }

      const item = itemById.get(row.itemId);
      suggestions.set(row.itemId, {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierSku: null,
        supplierSource: "history",
        unitCost: item?.defaultPurchasePrice ?? null,
        unitCostSource: item?.defaultPurchasePrice != null ? "item_default" : "unknown",
        purchaseUnitDefinitionId: item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: item?.purchaseUnitName ?? null,
        purchaseToStockFactor: item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          item?.purchaseUnitDefinitionId != null || item?.purchaseToStockFactor != null
            ? "item_default"
            : "default",
        leadTimeDaysOverride: null,
        minimumOrderQuantity: null,
        orderMultiple: null,
        reasonCodes: [],
      });
    }
  }

  for (const itemId of uniqueItemIds) {
    if (suggestions.has(itemId)) {
      continue;
    }

    if (activeSuppliers.length === 1) {
      const [supplier] = activeSuppliers;
      const item = itemById.get(itemId);
      suggestions.set(itemId, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierSku: null,
        supplierSource: "default",
        unitCost: item?.defaultPurchasePrice ?? null,
        unitCostSource: item?.defaultPurchasePrice != null ? "item_default" : "unknown",
        purchaseUnitDefinitionId: item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: item?.purchaseUnitName ?? null,
        purchaseToStockFactor: item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          item?.purchaseUnitDefinitionId != null || item?.purchaseToStockFactor != null
            ? "item_default"
            : "default",
        leadTimeDaysOverride: null,
        minimumOrderQuantity: null,
        orderMultiple: null,
        reasonCodes: [],
      });
      continue;
    }

    suggestions.set(itemId, {
      supplierId: null,
      supplierName: null,
      supplierSku: null,
      supplierSource: "unknown",
      unitCost: itemById.get(itemId)?.defaultPurchasePrice ?? null,
      unitCostSource:
        itemById.get(itemId)?.defaultPurchasePrice != null
          ? "item_default"
          : "unknown",
      purchaseUnitDefinitionId: itemById.get(itemId)?.purchaseUnitDefinitionId ?? null,
      purchaseUnitName: itemById.get(itemId)?.purchaseUnitName ?? null,
      purchaseToStockFactor: itemById.get(itemId)?.purchaseToStockFactor ?? "1",
      purchaseRuleSource:
        itemById.get(itemId)?.purchaseUnitDefinitionId != null ||
        itemById.get(itemId)?.purchaseToStockFactor != null
          ? "item_default"
          : "default",
      leadTimeDaysOverride: null,
      minimumOrderQuantity: null,
      orderMultiple: null,
      reasonCodes:
        activeSuppliers.length === 0 ? ["missing_supplier"] : ["ambiguous_supplier"],
    });
  }

  return suggestions;
}

async function getLeadTimeHistoryInTx(
  tx: Tx,
  itemIds: string[]
): Promise<Map<string, LeadTimeHistory>> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map();
  }

  const rows = await tx
    .select({
      itemId: purchaseOrderLines.itemId,
      orderedAt: purchaseOrders.orderedAt,
      receivedAt: purchaseOrders.receivedAt,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrderLines.itemId, uniqueItemIds),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrders.orderedAt} IS NOT NULL`,
        sql`${purchaseOrders.receivedAt} IS NOT NULL`,
        sql`${purchaseOrderLines.quantityReceived} > 0`
      )
    );

  const samplesByItem = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.orderedAt || !row.receivedAt) continue;
    const diffDays = Math.ceil(
      (row.receivedAt.getTime() - row.orderedAt.getTime()) / 86_400_000
    );
    if (!Number.isFinite(diffDays) || diffDays < 0) continue;
    const bucket = samplesByItem.get(row.itemId) ?? [];
    bucket.push(Math.max(1, diffDays));
    samplesByItem.set(row.itemId, bucket);
  }

  const history = new Map<string, LeadTimeHistory>();
  for (const [itemId, samples] of samplesByItem) {
    const leadTimeDays = percentile(samples, 75);
    if (leadTimeDays == null) continue;
    history.set(itemId, { leadTimeDays, sampleCount: samples.length });
  }

  return history;
}

function buildQuantityBuckets(
  demandFacts: DemandFact[],
  supplyFacts: SupplyFact[]
) {
  const buckets = new Map<string, QuantityBuckets>();

  for (const fact of demandFacts) {
    const bucket = buckets.get(fact.itemId) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };
    bucket.demandQuantity = roundQuantity(
      bucket.demandQuantity + toQuantity(fact.quantity)
    );
    buckets.set(fact.itemId, bucket);
  }

  for (const fact of supplyFacts) {
    const bucket = buckets.get(fact.itemId) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };

    if (fact.supplyType === "purchase_order") {
      bucket.incomingPurchaseOrderQuantity = roundQuantity(
        bucket.incomingPurchaseOrderQuantity + toQuantity(fact.quantity)
      );
    }

    if (fact.supplyType === "manufacturing_order") {
      bucket.incomingManufacturingOrderQuantity = roundQuantity(
        bucket.incomingManufacturingOrderQuantity + toQuantity(fact.quantity)
      );
    }

    buckets.set(fact.itemId, bucket);
  }

  return buckets;
}

function resolveLeadTime(args: {
  item: PlanningItemRecord;
  supplierSuggestion: SupplierSuggestion | undefined;
  history: LeadTimeHistory | undefined;
}) {
  if (args.supplierSuggestion?.leadTimeDaysOverride != null) {
    return {
      leadTimeDays: args.supplierSuggestion.leadTimeDaysOverride,
      leadTimeSource: "supplier_item" as PlanningRuleSource,
      leadTimeSampleCount: 0,
    };
  }

  const itemLeadTime = nullableNumber(args.item.leadTimeDaysOverride);
  if (itemLeadTime != null) {
    return {
      leadTimeDays: itemLeadTime,
      leadTimeSource: "manual" as PlanningRuleSource,
      leadTimeSampleCount: 0,
    };
  }

  if (args.history) {
    return {
      leadTimeDays: args.history.leadTimeDays,
      leadTimeSource: "history" as PlanningRuleSource,
      leadTimeSampleCount: args.history.sampleCount,
    };
  }

  return {
    leadTimeDays: null,
    leadTimeSource: "unknown" as PlanningRuleSource,
    leadTimeSampleCount: 0,
  };
}

function applyOrderRounding(args: {
  stockQuantity: number;
  minimumOrderQuantity: string | null | undefined;
  orderMultiple: string | null | undefined;
  purchaseToStockFactor: string | null | undefined;
}) {
  let quantity = positiveQuantity(args.stockQuantity);
  const factor = Math.max(1, toQuantity(args.purchaseToStockFactor ?? "1"));
  const minimum = nullableNumber(args.minimumOrderQuantity);
  const multiple = nullableNumber(args.orderMultiple);

  if (factor > 1) {
    quantity = Math.ceil(quantity / factor) * factor;
  }

  if (minimum != null && minimum > 0) {
    quantity = Math.max(quantity, minimum * factor);
  }

  if (multiple != null && multiple > 0) {
    const stockMultiple = multiple * factor;
    quantity = Math.ceil(quantity / stockMultiple) * stockMultiple;
  }

  return positiveQuantity(quantity);
}

function demandWithinWindow(
  demandFacts: DemandFact[],
  windowEnd: string | null
) {
  return demandFacts.reduce((sum, fact) => {
    if (windowEnd == null || fact.requiredDate == null || fact.requiredDate <= windowEnd) {
      return roundQuantity(sum + toQuantity(fact.quantity));
    }
    return sum;
  }, 0);
}

function supplyWithinWindow(
  supplyFacts: SupplyFact[],
  windowEnd: string | null
) {
  return supplyFacts.reduce((sum, fact) => {
    if (fact.supplyType === "available_inventory") {
      return sum;
    }

    if (windowEnd != null && fact.expectedDate != null && fact.expectedDate <= windowEnd) {
      return roundQuantity(sum + toQuantity(fact.quantity));
    }

    return sum;
  }, 0);
}

function computeReplenishmentMetadata(args: {
  item: PlanningItemRecord;
  itemDemandFacts: DemandFact[];
  itemSupplyFacts: SupplyFact[];
  onHandStock: number;
  shortageQuantity: number;
  supplierSuggestion: SupplierSuggestion | undefined;
  leadTimeHistory: LeadTimeHistory | undefined;
  horizonStart: string;
}) {
  const safetyStockTarget = args.itemDemandFacts.reduce(
    (sum, fact) =>
      fact.demandType === "safety_stock"
        ? roundQuantity(sum + toQuantity(fact.quantity))
        : sum,
    0
  );
  const safetyStockThreshold = safetyStockTarget;
  const targetCoverDays = nullableNumber(args.item.targetCoverDays);
  const leadTime = resolveLeadTime({
    item: args.item,
    supplierSuggestion: args.supplierSuggestion,
    history: args.leadTimeHistory,
  });
  const events = [
    ...args.itemDemandFacts
      .filter((fact) => fact.requiredDate != null)
      .map((fact) => ({
        date: fact.requiredDate!,
        quantity: -toQuantity(fact.quantity),
      })),
    ...args.itemSupplyFacts
      .filter((fact) => fact.supplyType !== "available_inventory" && fact.expectedDate != null)
      .map((fact) => ({
        date: fact.expectedDate!,
        quantity: toQuantity(fact.quantity),
      })),
  ].sort((left, right) => left.date.localeCompare(right.date));
  const hasUndatedDemand = args.itemDemandFacts.some(
    (fact) =>
      fact.demandType !== "safety_stock" &&
      fact.requiredDate == null &&
      toQuantity(fact.quantity) > 0
  );
  let projected = args.onHandStock;
  let crossingDate: string | null =
    projected <= Math.max(safetyStockThreshold, 0) ? args.horizonStart : null;

  for (const event of events) {
    if (crossingDate != null) break;
    projected = roundQuantity(projected + event.quantity);
    if (projected <= safetyStockThreshold || projected <= 0) {
      crossingDate = event.date;
    }
  }

  const latestFactDate = events.at(-1)?.date ?? null;
  const horizonEnd = latestFactDate ?? addDays(args.horizonStart, DEFAULT_COVER_HORIZON_DAYS);
  const daysOfCover =
    crossingDate != null
      ? daysBetween(args.horizonStart, crossingDate)
      : hasUndatedDemand
        ? null
        : daysBetween(args.horizonStart, horizonEnd);
  let daysOfCoverStatus: DaysOfCoverStatus = "unknown";

  if (args.shortageQuantity > 0) {
    daysOfCoverStatus = "order_now";
  } else if (daysOfCover != null && leadTime.leadTimeDays != null) {
    const orderSoonWindow = leadTime.leadTimeDays + (targetCoverDays ?? 0);
    daysOfCoverStatus =
      daysOfCover <= leadTime.leadTimeDays
        ? "order_now"
        : daysOfCover <= orderSoonWindow
          ? "order_soon"
          : "stocked";
  } else if (daysOfCover != null && crossingDate == null) {
    daysOfCoverStatus = "stocked";
  }

  const windowEnd =
    leadTime.leadTimeDays != null && targetCoverDays != null
      ? addDays(args.horizonStart, Math.ceil(leadTime.leadTimeDays + targetCoverDays))
      : null;
  const targetQuantity =
    windowEnd == null
      ? args.shortageQuantity
      : demandWithinWindow(args.itemDemandFacts, windowEnd) +
        safetyStockThreshold -
        args.onHandStock -
        supplyWithinWindow(args.itemSupplyFacts, windowEnd);
  const roundedSuggestion = applyOrderRounding({
    stockQuantity: Math.max(args.shortageQuantity, targetQuantity),
    minimumOrderQuantity: args.supplierSuggestion?.minimumOrderQuantity,
    orderMultiple: args.supplierSuggestion?.orderMultiple,
    purchaseToStockFactor: args.supplierSuggestion?.purchaseToStockFactor,
  });

  return {
    targetCoverDays,
    daysOfCover,
    daysOfCoverStatus,
    suggestedOrderQuantity:
      roundedSuggestion > 0 ? normalizeQuantity(roundedSuggestion) : null,
    ...leadTime,
    minimumOrderQuantity: args.supplierSuggestion?.minimumOrderQuantity ?? null,
    orderMultiple: args.supplierSuggestion?.orderMultiple ?? null,
  };
}

function computeBatchCount(item: PlanningItemRecord, quantity: number) {
  const expectedBatchYield = nullableNumber(item.expectedBatchYield);
  if (item.manufacturingMode !== "batch" || expectedBatchYield == null || expectedBatchYield <= 0) {
    return null;
  }

  return Math.ceil(quantity / expectedBatchYield);
}

function computeProductionMetadata(args: {
  item: PlanningItemRecord;
  shortageQuantity: number;
  earliestRequiredDate: string | null;
  horizonStart: string;
}) {
  const productionLeadTimeDays = nullableNumber(args.item.productionLeadTimeDays);
  const productionLeadTimeSource: PlanningRuleSource =
    productionLeadTimeDays != null ? "manual" : "unknown";
  const latestStartDate =
    args.earliestRequiredDate != null && productionLeadTimeDays != null
      ? subtractDays(args.earliestRequiredDate, Math.ceil(productionLeadTimeDays))
      : null;
  const productionBucket = productionBucketForDate(
    latestStartDate ?? args.earliestRequiredDate,
    args.horizonStart
  );

  return {
    productionLeadTimeDays,
    productionLeadTimeSource,
    latestStartDate,
    productionBucket,
    manufacturingMode: args.item.manufacturingMode,
    expectedBatchYield: args.item.expectedBatchYield,
    plannedBatchCount: computeBatchCount(args.item, args.shortageQuantity),
  };
}

function buildPlanningRows(args: {
  itemsList: PlanningItemRecord[];
  demandFacts: DemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
  supplierSuggestions: Map<string, SupplierSuggestion>;
  leadTimeHistory: Map<string, LeadTimeHistory>;
  horizonStart: string;
  bomByProductId?: Map<string, CurrentBomRecord>;
}): PlanningItemRow[] {
  const buckets = buildQuantityBuckets(args.demandFacts, args.supplyFacts);
  const demandFactsByItem = new Map<string, DemandFact[]>();
  const supplyFactsByItem = new Map<string, SupplyFact[]>();
  const inventoryByItem = new Map(
    args.inventoryFacts.map((fact) => [fact.itemId, fact])
  );

  for (const fact of args.demandFacts) {
    const bucket = demandFactsByItem.get(fact.itemId) ?? [];
    bucket.push(fact);
    demandFactsByItem.set(fact.itemId, bucket);
  }

  for (const fact of args.supplyFacts) {
    const bucket = supplyFactsByItem.get(fact.itemId) ?? [];
    bucket.push(fact);
    supplyFactsByItem.set(fact.itemId, bucket);
  }

  return args.itemsList.map((item) => {
    const bucket = buckets.get(item.id) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };
    const inventory = inventoryByItem.get(item.id);
    const onHandQuantity = toQuantity(inventory?.onHandQuantity);
    const reservedQuantity = toQuantity(inventory?.reservedQuantity);
    const availableStock = positiveQuantity(onHandQuantity - reservedQuantity);
    const projectedQuantity = roundQuantity(
      onHandQuantity +
        bucket.incomingPurchaseOrderQuantity +
        bucket.incomingManufacturingOrderQuantity -
        bucket.demandQuantity
    );
    const shortageQuantity = positiveQuantity(-projectedQuantity);
    const itemDemandFacts = demandFactsByItem.get(item.id) ?? [];
    const itemSupplyFacts = supplyFactsByItem.get(item.id) ?? [];
    const earliestRequiredDate = earliestDate(
      itemDemandFacts.map((fact) => fact.requiredDate)
    );
    const supplierSuggestion = args.supplierSuggestions.get(item.id);
    const replenishment = computeReplenishmentMetadata({
      item,
      itemDemandFacts,
      itemSupplyFacts,
      onHandStock: onHandQuantity,
      shortageQuantity,
      supplierSuggestion,
      leadTimeHistory: args.leadTimeHistory.get(item.id),
      horizonStart: args.horizonStart,
    });
    const planningType =
      item.itemType === "material"
        ? "buy"
        : item.itemType === "product"
          ? "make"
          : "unknown";
    const production =
      planningType === "make"
        ? computeProductionMetadata({
            item,
            shortageQuantity,
            earliestRequiredDate,
            horizonStart: args.horizonStart,
          })
        : {
            productionLeadTimeDays: null,
            productionLeadTimeSource: "unknown" as PlanningRuleSource,
            latestStartDate: null,
            productionBucket: "later" as ProductionBucket,
            manufacturingMode: null,
            expectedBatchYield: null,
            plannedBatchCount: null,
          };
    const missingProductionLeadTime =
      planningType === "make" &&
      shortageQuantity > 0 &&
      production.productionLeadTimeDays == null;
    const reasonCodes = uniqueReasonCodes([
      ...itemDemandFacts.flatMap((fact) => fact.reasonCodes),
      ...itemSupplyFacts.flatMap((fact) => fact.reasonCodes),
      ...(onHandQuantity > 0 ? ["inventory_available" as const] : []),
      ...(reservedQuantity > 0 ? ["reserved_stock" as const] : []),
      shortageQuantity > 0 ? "projected_shortage" : "no_shortage",
      ...(missingProductionLeadTime ? ["missing_production_lead_time" as const] : []),
      ...(!item.planningEnabled ? ["planning_disabled" as const] : []),
    ]);
    const hasSuggestedBuy =
      planningType === "buy" &&
      toQuantity(replenishment.suggestedOrderQuantity) > 0 &&
      ["order_now", "order_soon"].includes(replenishment.daysOfCoverStatus);
    const suggestedAction =
      !item.planningEnabled
        ? "none"
        : planningType === "buy" && (shortageQuantity > 0 || hasSuggestedBuy)
          ? "buy"
          : shortageQuantity <= 0
            ? "none"
            : planningType === "make"
              ? "make"
              : "review";

    return {
      item: {
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        displayAttrs: item.displayAttrs,
        sku: item.sku,
        itemType: item.itemType,
        unitName: item.unitName,
        unitUom: item.unitUom,
      },
      planningType,
      demandQuantity: normalizeQuantity(bucket.demandQuantity),
      availableStock: normalizeQuantity(availableStock),
      reservedQuantity: normalizeQuantity(reservedQuantity),
      incomingPurchaseOrderQuantity: normalizeQuantity(
        bucket.incomingPurchaseOrderQuantity
      ),
      incomingManufacturingOrderQuantity: normalizeQuantity(
        bucket.incomingManufacturingOrderQuantity
      ),
      projectedQuantity: normalizeQuantity(projectedQuantity),
      shortageQuantity: normalizeQuantity(shortageQuantity),
      earliestRequiredDate,
      safetyStock: item.safetyStock,
      targetCoverDays: replenishment.targetCoverDays,
      daysOfCover: replenishment.daysOfCover,
      daysOfCoverStatus: replenishment.daysOfCoverStatus,
      suggestedOrderQuantity: replenishment.suggestedOrderQuantity,
      leadTimeDays: replenishment.leadTimeDays,
      leadTimeSource: replenishment.leadTimeSource,
      leadTimeSampleCount: replenishment.leadTimeSampleCount,
      minimumOrderQuantity: replenishment.minimumOrderQuantity,
      orderMultiple: replenishment.orderMultiple,
      preferredSupplierId: supplierSuggestion?.supplierId ?? null,
      preferredSupplierName: supplierSuggestion?.supplierName ?? null,
      preferredSupplierSku: supplierSuggestion?.supplierSku ?? null,
      preferredSupplierSource: supplierSuggestion?.supplierSource ?? "unknown",
      purchaseUnitDefinitionId:
        supplierSuggestion?.purchaseUnitDefinitionId ??
        item.purchaseUnitDefinitionId ??
        null,
      purchaseUnitName:
        supplierSuggestion?.purchaseUnitName ?? item.purchaseUnitName ?? null,
      purchaseToStockFactor:
        supplierSuggestion?.purchaseToStockFactor ??
        item.purchaseToStockFactor ??
        "1",
      purchaseRuleSource: supplierSuggestion?.purchaseRuleSource ?? "default",
      unitCost: supplierSuggestion?.unitCost ?? item.defaultPurchasePrice,
      unitCostSource:
        supplierSuggestion?.unitCostSource ??
        (item.defaultPurchasePrice != null ? "item_default" : "unknown"),
      productionLeadTimeDays: production.productionLeadTimeDays,
      productionLeadTimeSource: production.productionLeadTimeSource,
      latestStartDate: production.latestStartDate,
      productionBucket: production.productionBucket,
      manufacturingMode: production.manufacturingMode,
      expectedBatchYield: production.expectedBatchYield,
      plannedBatchCount: production.plannedBatchCount,
      suggestedAction,
      reasonCodes,
      sourceRefs: uniqueSourceRefs([
        itemRef(item),
        ...(inventory?.sourceRefs ?? []),
        ...itemDemandFacts.flatMap((fact) => fact.sourceRefs),
        ...itemSupplyFacts.flatMap((fact) => fact.sourceRefs),
      ]),
      explanationSummary:
        shortageQuantity > 0
          ? `${item.name} is short ${normalizeQuantity(shortageQuantity)} after netting demand and open supply.`
          : `${item.name} has no projected shortage.`,
      recommendationId: null,
    } satisfies PlanningItemRow;
  });
}

function addBomExplosionDemand(args: {
  row: PlanningItemRow;
  itemById: Map<string, PlanningItemRecord>;
  bomByProductId: Map<string, CurrentBomRecord>;
  demandFactsByItem: Map<string, InternalDemandFact[]>;
  level: number;
  warnings: PlanningWarning[];
}): {
  demandFacts: InternalDemandFact[];
  bomRequirementFacts: BomRequirementFact[];
} {
  const parentItem = args.itemById.get(args.row.item.id);
  const bom = args.bomByProductId.get(args.row.item.id);
  const parentDemandFacts = args.demandFactsByItem.get(args.row.item.id) ?? [];
  const parentDemandFact =
    parentDemandFacts.length > 0
      ? parentDemandFacts.reduce((longest, fact) =>
          fact.explosionPath.length >= longest.explosionPath.length
            ? fact
            : longest
        )
      : null;

  if (!parentItem || !parentDemandFact || !bom || bom.components.length === 0) {
    return { demandFacts: [], bomRequirementFacts: [] };
  }

  const parentShortageQuantity = toQuantity(args.row.shortageQuantity);
  const demandFacts: InternalDemandFact[] = [];
  const bomRequirementFacts: BomRequirementFact[] = [];

  for (const component of bom.components) {
    const componentQuantity = roundQuantity(
      parentShortageQuantity * toQuantity(component.quantity)
    );
    if (componentQuantity <= 0) {
      continue;
    }

    if (parentDemandFact.explosionPath.includes(component.componentId)) {
      args.warnings.push({
        code: "bom_cycle_detected",
        severity: "error",
        message: `BOM cycle detected while exploding ${parentItem.name}.`,
        itemId: component.componentId,
        sourceRefs: uniqueSourceRefs([
          ...args.row.sourceRefs,
          {
            sourceType: "bom_revision",
            sourceId: bom.revisionId,
            label: `BOM revision ${bom.revisionNumber}`,
            itemId: parentItem.id,
          },
        ]),
      });
      continue;
    }

    const quantity = normalizeQuantity(componentQuantity);
    const factId = [
      "demand:bom",
      args.level,
      args.row.item.id,
      component.componentId,
      bom.revisionId,
      parentDemandFact.id,
    ].join(":");
    const sourceRefs = uniqueSourceRefs([
      ...args.row.sourceRefs,
      {
        sourceType: "bom_revision",
        sourceId: bom.revisionId,
        label: `BOM revision ${bom.revisionNumber}`,
        itemId: parentItem.id,
        quantity: component.quantity,
      },
    ]);

    demandFacts.push({
      id: factId,
      itemId: component.componentId,
      demandType: "bom_explosion",
      quantity,
      requiredDate: args.row.earliestRequiredDate,
      reasonCodes: ["bom_component_demand"],
      sourceRefs,
      parentItemId: parentItem.id,
      parentDemandFactId: parentDemandFact.id,
      bomRevisionId: bom.revisionId,
      explanation: `${parentItem.name} shortage creates ${quantity} ${component.componentName} demand through BOM revision ${bom.revisionNumber}.`,
      explosionPath: [...parentDemandFact.explosionPath, component.componentId],
    });

    bomRequirementFacts.push({
      id: `bom:req:${factId}`,
      parentItemId: parentItem.id,
      componentItemId: component.componentId,
      bomRevisionId: bom.revisionId,
      parentDemandFactId: parentDemandFact.id,
      level: args.level,
      quantityPerParent: component.quantity,
      parentShortageQuantity: args.row.shortageQuantity,
      requiredQuantity: quantity,
      reasonCodes: ["bom_component_demand"],
      sourceRefs,
    });
  }

  return { demandFacts, bomRequirementFacts };
}

function buildRowsWithBomExplosion(args: {
  itemsList: PlanningItemRecord[];
  baseDemandFacts: InternalDemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
  bomByProductId: Map<string, CurrentBomRecord>;
  supplierSuggestions: Map<string, SupplierSuggestion>;
  leadTimeHistory: Map<string, LeadTimeHistory>;
  horizonStart: string;
  warnings: PlanningWarning[];
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const demandFacts: InternalDemandFact[] = [...args.baseDemandFacts];
  const bomRequirementFacts: BomRequirementFact[] = [];
  const explodedParentKeys = new Set<string>();
  let rows = buildPlanningRows({
    itemsList: args.itemsList,
    demandFacts,
    supplyFacts: args.supplyFacts,
    inventoryFacts: args.inventoryFacts,
    supplierSuggestions: args.supplierSuggestions,
    leadTimeHistory: args.leadTimeHistory,
    horizonStart: args.horizonStart,
    bomByProductId: args.bomByProductId,
  });

  for (let level = 1; level <= MAX_BOM_EXPLOSION_LEVEL; level += 1) {
    const demandFactsByItem = new Map<string, InternalDemandFact[]>();
    for (const fact of demandFacts) {
      const bucket = demandFactsByItem.get(fact.itemId) ?? [];
      bucket.push(fact);
      demandFactsByItem.set(fact.itemId, bucket);
    }

    let addedFacts = 0;
    const parentRows = rows
      .filter(
        (row) =>
          row.planningType === "make" &&
          toQuantity(row.shortageQuantity) > 0 &&
          args.bomByProductId.has(row.item.id)
      )
      .sort((left, right) => left.item.name.localeCompare(right.item.name));

    for (const row of parentRows) {
      const parentKey = `${row.item.id}:${row.shortageQuantity}`;
      if (explodedParentKeys.has(parentKey)) {
        continue;
      }
      explodedParentKeys.add(parentKey);

      const explosion = addBomExplosionDemand({
        row,
        itemById,
        bomByProductId: args.bomByProductId,
        demandFactsByItem,
        level,
        warnings: args.warnings,
      });

      demandFacts.push(...explosion.demandFacts);
      bomRequirementFacts.push(...explosion.bomRequirementFacts);
      addedFacts += explosion.demandFacts.length;
    }

    rows = buildPlanningRows({
      itemsList: args.itemsList,
      demandFacts,
      supplyFacts: args.supplyFacts,
      inventoryFacts: args.inventoryFacts,
      supplierSuggestions: args.supplierSuggestions,
      leadTimeHistory: args.leadTimeHistory,
      horizonStart: args.horizonStart,
      bomByProductId: args.bomByProductId,
    });

    if (addedFacts === 0) {
      return { rows, demandFacts, bomRequirementFacts };
    }
  }

  args.warnings.push({
    code: "bom_depth_limit",
    severity: "warning",
    message: `BOM explosion stopped at ${MAX_BOM_EXPLOSION_LEVEL} levels.`,
    sourceRefs: [],
  });

  return { rows, demandFacts, bomRequirementFacts };
}

function buildProductionBlockerFacts(args: {
  rows: PlanningItemRow[];
  bomRequirementFacts: BomRequirementFact[];
  bomByProductId: Map<string, CurrentBomRecord>;
  warnings: PlanningWarning[];
}): ProductionBlockerFact[] {
  const rowsByItemId = new Map(args.rows.map((row) => [row.item.id, row]));
  const blockers: ProductionBlockerFact[] = [];

  for (const fact of args.bomRequirementFacts) {
    const parent = rowsByItemId.get(fact.parentItemId);
    const component = rowsByItemId.get(fact.componentItemId);
    if (!parent || !component || toQuantity(component.shortageQuantity) <= 0) {
      continue;
    }

    blockers.push({
      id: `production:blocker:material:${fact.id}`,
      parentItemId: parent.item.id,
      parentItemName: parent.item.name,
      parentRecommendationId: parent.recommendationId,
      componentItemId: component.item.id,
      componentItemName: component.item.name,
      componentUnitName: component.item.unitName,
      requiredQuantity: fact.requiredQuantity,
      availableQuantity: component.availableStock,
      shortageQuantity: component.shortageQuantity,
      blockerType: "material_shortage",
      earliestRequiredDate: parent.earliestRequiredDate,
      sourceRefs: fact.sourceRefs,
    });
  }

  for (const row of args.rows.filter((entry) => entry.planningType === "make")) {
    const hasShortage = toQuantity(row.shortageQuantity) > 0;
    const bom = args.bomByProductId.get(row.item.id);
    if (hasShortage && (!bom || bom.components.length === 0)) {
      blockers.push({
        id: `production:blocker:missing-bom:${row.item.id}`,
        parentItemId: row.item.id,
        parentItemName: row.item.name,
        parentRecommendationId: row.recommendationId,
        componentItemId: null,
        componentItemName: null,
        componentUnitName: null,
        requiredQuantity: row.shortageQuantity,
        availableQuantity: row.availableStock,
        shortageQuantity: row.shortageQuantity,
        blockerType: "missing_bom",
        earliestRequiredDate: row.earliestRequiredDate,
        sourceRefs: row.sourceRefs,
      });
    }

    if (hasShortage && row.productionLeadTimeDays == null) {
      blockers.push({
        id: `production:blocker:missing_production_lead_time:${row.item.id}`,
        parentItemId: row.item.id,
        parentItemName: row.item.name,
        parentRecommendationId: row.recommendationId,
        componentItemId: null,
        componentItemName: null,
        componentUnitName: null,
        requiredQuantity: row.shortageQuantity,
        availableQuantity: row.availableStock,
        shortageQuantity: row.shortageQuantity,
        blockerType: "missing_production_lead_time",
        earliestRequiredDate: row.earliestRequiredDate,
        sourceRefs: row.sourceRefs,
      });
    }
  }

  for (const warning of args.warnings) {
    const blockerType =
      warning.code === "bom_cycle_detected"
        ? "bom_cycle_detected"
        : warning.code === "bom_depth_limit"
          ? "bom_depth_limit"
          : null;
    if (!blockerType || !warning.itemId) continue;
    const parent = rowsByItemId.get(warning.itemId);
    if (!parent) continue;

    blockers.push({
      id: `production:blocker:${blockerType}:${warning.itemId}`,
      parentItemId: parent.item.id,
      parentItemName: parent.item.name,
      parentRecommendationId: parent.recommendationId,
      componentItemId: null,
      componentItemName: null,
      componentUnitName: null,
      requiredQuantity: parent.shortageQuantity,
      availableQuantity: parent.availableStock,
      shortageQuantity: parent.shortageQuantity,
      blockerType,
      earliestRequiredDate: parent.earliestRequiredDate,
      sourceRefs: warning.sourceRefs,
    });
  }

  return blockers;
}

function warningForRow(args: {
  code: PlanningReasonCode;
  message: string;
  itemId: string;
  sourceRefs: PlanningSourceRef[];
}): PlanningWarning {
  return {
    code: args.code,
    severity: "warning",
    message: args.message,
    itemId: args.itemId,
    sourceRefs: args.sourceRefs,
  };
}

function buildRecommendations(args: {
  rows: PlanningItemRow[];
  itemsList: PlanningItemRecord[];
  bomByProductId: Map<string, CurrentBomRecord>;
  supplierSuggestions: Map<string, SupplierSuggestion>;
  inputHash: string;
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const recommendations: PlanningRecommendation[] = [];
  const rowRecommendationIdByItem = new Map<string, string>();

  for (const row of args.rows) {
    const shortageQuantity = toQuantity(row.shortageQuantity);
    const recommendationQuantity =
      row.planningType === "buy"
        ? row.suggestedOrderQuantity ?? row.shortageQuantity
        : row.shortageQuantity;
    if (
      row.reasonCodes.includes("planning_disabled") ||
      toQuantity(recommendationQuantity) <= 0 ||
      (row.planningType !== "buy" && shortageQuantity <= 0)
    ) {
      continue;
    }

    const item = itemById.get(row.item.id);
    if (!item) {
      continue;
    }

    if (row.planningType === "buy") {
      const supplierSuggestion = args.supplierSuggestions.get(item.id) ?? {
        supplierId: null,
        supplierName: null,
        supplierSku: null,
        supplierSource: "unknown" as PlanningRuleSource,
        unitCost: null,
        unitCostSource: "unknown" as PlanningRuleSource,
        purchaseUnitDefinitionId: item.purchaseUnitDefinitionId,
        purchaseUnitName: item.purchaseUnitName,
        purchaseToStockFactor: item.purchaseToStockFactor ?? "1",
        purchaseRuleSource: "item_default" as PlanningRuleSource,
        leadTimeDaysOverride: null,
        minimumOrderQuantity: null,
        orderMultiple: null,
        reasonCodes: ["missing_supplier"] satisfies PlanningReasonCode[],
      };
      const unitCost = row.unitCost ?? supplierSuggestion.unitCost;
      const purchaseToStockFactor =
        row.purchaseToStockFactor ?? supplierSuggestion.purchaseToStockFactor ?? "1";
      const hasPurchasePrice = unitCost != null && toQuantity(unitCost) >= 0;
      const warningCodes = [
        ...supplierSuggestion.reasonCodes,
        ...(!hasPurchasePrice
          ? ["missing_purchase_price" as const]
          : []),
      ];
      const recommendationType =
        warningCodes.length > 0 ? "review_item_setup" : "create_purchase_order";
      const recommendationId = buildRecommendationId({
        recommendationType,
        itemId: item.id,
        quantity: recommendationQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = warningCodes.map((code) =>
        warningForRow({
          code,
          itemId: item.id,
          sourceRefs: row.sourceRefs,
          message:
            code === "missing_purchase_price"
              ? `${item.name} needs a purchase price before planning can draft a purchase order.`
              : code === "ambiguous_supplier"
                ? `${item.name} has no item-specific supplier history and multiple suppliers exist.`
                : `${item.name} needs a supplier before planning can draft a purchase order.`,
        })
      );

      rowRecommendationIdByItem.set(item.id, recommendationId);
      recommendations.push({
        id: recommendationId,
        recommendationType,
        itemId: item.id,
        quantity: recommendationQuantity,
        requiredDate: row.earliestRequiredDate,
        suggestedSupplierId: supplierSuggestion.supplierId,
        suggestedSupplierName: supplierSuggestion.supplierName,
        suggestedBomRevisionId: null,
        reasonCodes: uniqueReasonCodes([
          ...row.reasonCodes,
          "buy_item",
          ...warningCodes,
        ]),
        sourceRefs: row.sourceRefs,
        warnings,
        actionPayload:
          recommendationType === "create_purchase_order" &&
          supplierSuggestion.supplierId != null &&
          hasPurchasePrice &&
          unitCost != null
            ? {
                actionType: "create_purchase_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: recommendationQuantity,
                requiredDate: row.earliestRequiredDate,
                supplierId: supplierSuggestion.supplierId,
                unitCost,
                purchaseUnitDefinitionId: row.purchaseUnitDefinitionId,
                purchaseToStockFactor,
                sourceRefs: row.sourceRefs,
              }
            : null,
        explanation:
          recommendationType === "create_purchase_order"
            ? `Draft a purchase order for ${recommendationQuantity} ${item.name}.`
            : `Review purchasing setup for ${item.name}.`,
      });
      continue;
    }

    if (row.planningType === "make") {
      const bom = args.bomByProductId.get(item.id);
      const hasBom = Boolean(bom && bom.components.length > 0);
      const hasProductionLeadTime = row.productionLeadTimeDays != null;
      const recommendationType = hasBom && hasProductionLeadTime
        ? "create_manufacturing_order"
        : "review_item_setup";
      const recommendationId = buildRecommendationId({
        recommendationType,
        itemId: item.id,
        quantity: row.shortageQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = [
        ...(!hasBom
          ? [
              warningForRow({
                code: "missing_bom" as const,
                itemId: item.id,
                sourceRefs: row.sourceRefs,
                message: `${item.name} needs a current BOM before planning can draft a manufacturing order.`,
              }),
            ]
          : []),
        ...(!hasProductionLeadTime
          ? [
              warningForRow({
                code: "missing_production_lead_time" as const,
                itemId: item.id,
                sourceRefs: row.sourceRefs,
                message: `${item.name} needs production lead time before planning can draft a manufacturing order.`,
              }),
            ]
          : []),
      ];

      rowRecommendationIdByItem.set(item.id, recommendationId);
      recommendations.push({
        id: recommendationId,
        recommendationType,
        itemId: item.id,
        quantity: row.shortageQuantity,
        requiredDate: row.earliestRequiredDate,
        suggestedSupplierId: null,
        suggestedSupplierName: null,
        suggestedBomRevisionId: bom?.revisionId ?? null,
        reasonCodes: uniqueReasonCodes([
          ...row.reasonCodes,
          "make_item",
          ...(hasBom ? [] : ["missing_bom" as const]),
          ...(hasProductionLeadTime
            ? []
            : ["missing_production_lead_time" as const]),
        ]),
        sourceRefs: row.sourceRefs,
        warnings,
        actionPayload:
          hasBom && hasProductionLeadTime && bom
            ? {
                actionType: "create_manufacturing_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: row.shortageQuantity,
                requiredDate: row.earliestRequiredDate,
                latestStartDate: row.latestStartDate,
                bomRevisionId: bom.revisionId,
                ingredients: bom.components.map((component) => ({
                  itemId: component.componentId,
                  quantityPerUnit: component.quantity,
                })),
                sourceRefs: row.sourceRefs,
              }
            : null,
        explanation:
          recommendationType === "create_manufacturing_order"
            ? `Draft a manufacturing order for ${row.shortageQuantity} ${item.name}.`
            : `Review manufacturing setup for ${item.name}.`,
      });
      continue;
    }

    const recommendationId = buildRecommendationId({
      recommendationType: "review_item_setup",
      itemId: item.id,
      quantity: row.shortageQuantity,
      sourceRefs: row.sourceRefs,
    });
    rowRecommendationIdByItem.set(item.id, recommendationId);
    recommendations.push({
      id: recommendationId,
      recommendationType: "review_item_setup",
      itemId: item.id,
      quantity: row.shortageQuantity,
      requiredDate: row.earliestRequiredDate,
      suggestedSupplierId: null,
      suggestedSupplierName: null,
      suggestedBomRevisionId: null,
      reasonCodes: row.reasonCodes,
      sourceRefs: row.sourceRefs,
      warnings: [],
      actionPayload: null,
      explanation: `Review planning setup for ${item.name}.`,
    });
  }

  const rows = args.rows.map((row) => ({
    ...row,
    recommendationId: rowRecommendationIdByItem.get(row.item.id) ?? null,
    suggestedAction:
      rowRecommendationIdByItem.has(row.item.id) && row.suggestedAction === "none"
        ? "review"
        : row.suggestedAction,
  }));

  return { rows, recommendations };
}

export async function buildPlanningSnapshotInTx(
  tx: Tx,
  orgId: string,
  generatedAt: Date = new Date()
): Promise<PlanningSnapshot> {
  const horizonStart = isoDate(generatedAt);
  const horizonEnd = addDays(horizonStart, DEFAULT_COVER_HORIZON_DAYS);
  const itemsList = await getPlanningItemsInTx(tx);
  const productIds = itemsList
    .filter((item) => item.itemType === "product")
    .map((item) => item.id);
  const salesDemandFacts = await getSalesDemandFactsInTx(tx);
  const manufacturingComponentDemandFacts =
    await getOpenManufacturingComponentDemandFactsInTx(tx);
  const purchaseSupplyFacts = await getPurchaseSupplyFactsInTx(tx);
  const manufacturingSupplyFacts = await getManufacturingSupplyFactsInTx(tx);
  const bomByProductId = await getCurrentBomsInTx(tx, productIds);
  const supplierSuggestions = await getSupplierSuggestionsInTx(tx, itemsList);
  const materialIds = itemsList
    .filter((item) => item.itemType === "material")
    .map((item) => item.id);
  const leadTimeHistory = await getLeadTimeHistoryInTx(tx, materialIds);
  const inventoryFacts = getInventoryFacts(itemsList);
  const supplyFacts = [
    ...getInventorySupplyFacts(itemsList, inventoryFacts),
    ...purchaseSupplyFacts,
    ...manufacturingSupplyFacts,
  ];
  const baseDemandFacts = [
    ...salesDemandFacts,
    ...getSafetyStockDemandFacts(itemsList),
    ...manufacturingComponentDemandFacts,
  ];
  const warnings: PlanningWarning[] = [];
  const { rows: explodedRows, demandFacts, bomRequirementFacts } =
    buildRowsWithBomExplosion({
      itemsList,
      baseDemandFacts,
      supplyFacts,
      inventoryFacts,
      bomByProductId,
      supplierSuggestions,
      leadTimeHistory,
      horizonStart,
      warnings,
    });
  const assumptions = [
    {
      code: "dated_cover_horizon",
      description: `Days of cover uses dated demand and supply through ${DEFAULT_COVER_HORIZON_DAYS} days when no later facts exist.`,
    },
    {
      code: "single_default_location",
      description: "Inventory quantities use the default location projection.",
    },
    {
      code: "quality_disposition_not_configured",
      description: "No quality disposition table exists in this schema, so projected on-hand stock is treated as usable.",
    },
    {
      code: "current_bom_only",
      description: `BOM explosion uses current BOM revisions and stops after ${MAX_BOM_EXPLOSION_LEVEL} levels or at cycles.`,
    },
    {
      code: "supplier_resolution_order",
      description: "Supplier planning uses preferred supplier-item rules, then purchase history, then the sole active supplier.",
    },
  ];
  const inputHash = hashValue({
    assumptions,
    items: itemsList,
    inventoryFacts,
    demandFacts,
    supplyFacts,
    bomRequirementFacts,
    leadTimeHistory: [...leadTimeHistory.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    supplierSuggestions: [...supplierSuggestions.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    warnings,
  });
  const { rows, recommendations } = buildRecommendations({
    rows: explodedRows,
    itemsList,
    bomByProductId,
    supplierSuggestions,
    inputHash,
  });
  const productionBlockerFacts = buildProductionBlockerFacts({
    rows,
    bomRequirementFacts,
    bomByProductId,
    warnings,
  });

  return {
    orgId,
    generatedAt: generatedAt.toISOString(),
    horizonStart,
    horizonEnd,
    inputHash,
    assumptions,
    rows,
    demandFacts: demandFacts.map((fact) => ({
      id: fact.id,
      itemId: fact.itemId,
      demandType: fact.demandType,
      quantity: fact.quantity,
      requiredDate: fact.requiredDate,
      reasonCodes: fact.reasonCodes,
      sourceRefs: fact.sourceRefs,
      parentItemId: fact.parentItemId,
      parentDemandFactId: fact.parentDemandFactId,
      bomRevisionId: fact.bomRevisionId,
      explanation: fact.explanation,
    })),
    supplyFacts,
    inventoryFacts,
    bomRequirementFacts,
    productionBlockerFacts,
    recommendations,
    warnings: [
      ...warnings,
      ...recommendations.flatMap((recommendation) => recommendation.warnings),
    ],
  };
}

export async function getPlanningSnapshot(options?: {
  generatedAt?: Date;
}): Promise<PlanningSnapshot> {
  return withAuthedOrgContext((tx, orgId) =>
    buildPlanningSnapshotInTx(tx, orgId, options?.generatedAt ?? new Date())
  );
}
