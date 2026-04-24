import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
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
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type {
  BomRequirementFact,
  DemandFact,
  InventoryFact,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningReasonCode,
  PlanningSnapshot,
  PlanningSourceRef,
  PlanningWarning,
  SupplyFact,
} from "./types";

const MAX_BOM_EXPLOSION_LEVEL = 8;

type PlanningItemRecord = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  unitName: string | null;
  safetyStock: string;
  onHandQuantity: string;
  reservedQuantity: string;
  expectedQuantity: string;
  defaultPurchasePrice: string | null;
  purchaseToStockFactor: string | null;
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
  reasonCodes: PlanningReasonCode[];
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
  return tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
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
      purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
        "purchaseToStockFactor"
      ),
    })
    .from(items)
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(and(isNull(items.deletedAt), eq(items.isMaster, false)))
    .orderBy(asc(items.name), asc(items.id));
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
        label: row.orderNumber,
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
  itemIds: string[]
): Promise<Map<string, SupplierSuggestion>> {
  const activeSuppliers = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt))
    .orderBy(asc(suppliers.name), asc(suppliers.id));

  const suggestions = new Map<string, SupplierSuggestion>();
  const uniqueItemIds = [...new Set(itemIds)];

  if (uniqueItemIds.length > 0) {
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

      suggestions.set(row.itemId, {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
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
      suggestions.set(itemId, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        reasonCodes: [],
      });
      continue;
    }

    suggestions.set(itemId, {
      supplierId: null,
      supplierName: null,
      reasonCodes:
        activeSuppliers.length === 0 ? ["missing_supplier"] : ["ambiguous_supplier"],
    });
  }

  return suggestions;
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

function buildPlanningRows(args: {
  itemsList: PlanningItemRecord[];
  demandFacts: DemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
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
    const reasonCodes = uniqueReasonCodes([
      ...itemDemandFacts.flatMap((fact) => fact.reasonCodes),
      ...itemSupplyFacts.flatMap((fact) => fact.reasonCodes),
      ...(onHandQuantity > 0 ? ["inventory_available" as const] : []),
      ...(reservedQuantity > 0 ? ["reserved_stock" as const] : []),
      shortageQuantity > 0 ? "projected_shortage" : "no_shortage",
    ]);
    const planningType =
      item.itemType === "material"
        ? "buy"
        : item.itemType === "product"
          ? "make"
          : "unknown";
    const suggestedAction =
      shortageQuantity <= 0
        ? "none"
        : planningType === "buy"
          ? "buy"
          : planningType === "make"
            ? "make"
            : "review";

    return {
      item: {
        id: item.id,
        name: item.name,
        sku: item.sku,
        itemType: item.itemType,
        unitName: item.unitName,
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
      earliestRequiredDate: earliestDate(itemDemandFacts.map((fact) => fact.requiredDate)),
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
  const parentDemandFact = parentDemandFacts[0];

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
    if (shortageQuantity <= 0) {
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
        reasonCodes: ["missing_supplier"] satisfies PlanningReasonCode[],
      };
      const hasPurchasePrice =
        item.defaultPurchasePrice != null && toQuantity(item.defaultPurchasePrice) > 0;
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
        quantity: row.shortageQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = warningCodes.map((code) =>
        warningForRow({
          code,
          itemId: item.id,
          sourceRefs: row.sourceRefs,
          message:
            code === "missing_purchase_price"
              ? `${item.name} needs a default purchase price before planning can draft a purchase order.`
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
        quantity: row.shortageQuantity,
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
          item.defaultPurchasePrice != null
            ? {
                actionType: "create_purchase_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: row.shortageQuantity,
                requiredDate: row.earliestRequiredDate,
                supplierId: supplierSuggestion.supplierId,
                unitCost: item.defaultPurchasePrice,
                sourceRefs: row.sourceRefs,
              }
            : null,
        explanation:
          recommendationType === "create_purchase_order"
            ? `Draft a purchase order for ${row.shortageQuantity} ${item.name}.`
            : `Review purchasing setup for ${item.name}.`,
      });
      continue;
    }

    if (row.planningType === "make") {
      const bom = args.bomByProductId.get(item.id);
      const hasBom = Boolean(bom && bom.components.length > 0);
      const recommendationType = hasBom
        ? "create_manufacturing_order"
        : "review_item_setup";
      const recommendationId = buildRecommendationId({
        recommendationType,
        itemId: item.id,
        quantity: row.shortageQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = hasBom
        ? []
        : [
            warningForRow({
              code: "missing_bom",
              itemId: item.id,
              sourceRefs: row.sourceRefs,
              message: `${item.name} needs a current BOM before planning can draft a manufacturing order.`,
            }),
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
        ]),
        sourceRefs: row.sourceRefs,
        warnings,
        actionPayload:
          hasBom && bom
            ? {
                actionType: "create_manufacturing_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: row.shortageQuantity,
                requiredDate: row.earliestRequiredDate,
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
  const supplierSuggestions = await getSupplierSuggestionsInTx(
    tx,
    itemsList.filter((item) => item.itemType === "material").map((item) => item.id)
  );
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
      warnings,
    });
  const assumptions = [
    {
      code: "no_time_horizon",
      description: "Planning includes all current open demand and open supply; no forecast horizon is applied.",
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
      code: "supplier_suggestion_limited",
      description: "Supplier suggestions use item purchase history or the sole active supplier because preferred supplier metadata is not available yet.",
    },
  ];
  const inputHash = hashValue({
    assumptions,
    items: itemsList,
    inventoryFacts,
    demandFacts,
    supplyFacts,
    bomRequirementFacts,
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

  return {
    orgId,
    generatedAt: generatedAt.toISOString(),
    horizonStart: null,
    horizonEnd: null,
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
